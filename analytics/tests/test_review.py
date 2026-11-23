"""Independent regression checks using an isolated synthetic corpus."""

import tempfile
import unittest
from pathlib import Path

from analytics.config import Settings
from analytics.contracts import RunRequest, SyncRequest
from analytics.corpus import Corpus
from analytics.jobs import Jobs
from analytics.storage import AnalyticsError, Database, dumps, now


class NoNetworkProvider:
    def require_model(self):
        return None


class SyntheticExtractionProvider(NoNetworkProvider):
    def json(self, _system, data, _run_id):
        return {
            "findings": [
                {
                    "recordId": item["recordId"],
                    "field": "text",
                    "quote": item["fields"]["text"],
                    "title": item["fields"]["text"],
                    "summary": item["fields"]["text"],
                    "attribution": "self",
                    "reason": "دادهٔ آزمایشی",
                }
                for item in data["records"]
            ]
        }


class LifecycleReview(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="crm-review-")
        self.db = Database(
            "sqlite:///" + str(Path(self.directory.name) / "data.sqlite")
        )
        self.corpus = Corpus(self.db)
        self.jobs = Jobs(
            Settings(worker_enabled=False), self.db, self.corpus, NoNetworkProvider()
        )
        self.original = {
            "id": "message:original",
            "kind": "message",
            "sourceId": "qa-source",
            "contactId": "qa-contact",
            "conversationId": "qa-conversation",
            "role": "user",
            "occurredAt": 1795293000,
            "text": "یک روایت آزمایشی برای بررسی چرخه داده",
            "metadata": {},
        }
        self.sync("baseline", 1, [self.original])

    def tearDown(self):
        self.directory.cleanup()

    def sync(self, identifier, sequence, records):
        return self.corpus.sync(
            SyncRequest.model_validate(
                {
                    "generation": "qa-generation",
                    "snapshotId": identifier,
                    "sequence": sequence,
                    "sources": [
                        {
                            "id": "qa-source",
                            "slug": "qa",
                            "name": "QA",
                            "kind": "chatbot",
                            "platform": "bale",
                        }
                    ],
                    "records": records,
                    "complete": True,
                }
            )
        )

    def test_deleted_source_text_is_not_reused_as_model_history(self):
        session = self.jobs.create_session("owner", "QA session")
        run = self.jobs.create(
            "owner", RunRequest(kind="research", sessionId=session["id"])
        )
        for role in ("user", "assistant"):
            self.db.execute(
                "INSERT INTO session_messages(id,session_id,role,content,run_id,created_at) VALUES (?,?,?,?,?,?)",
                (
                    "history-" + role,
                    session["id"],
                    role,
                    "deleted-source-sentinel",
                    run["id"],
                    now(),
                ),
            )
        self.sync("after-delete", 2, [])
        history = self.jobs._history(session["id"])
        self.assertNotIn("deleted-source-sentinel", dumps(history))

    def test_append_only_sync_preserves_three_at_a_time_cursor(self):
        run = self.jobs.create("owner", RunRequest(kind="experiences", limit=3))
        items = [{"id": f"experience-{index}"} for index in range(7)]
        self.db.execute(
            "INSERT INTO result_sets(id,owner,run_id,items,created_at) VALUES (?,?,?,?,?)",
            ("stable-list", "owner", run["id"], dumps(items), now()),
        )
        first = self.jobs.result_page("owner", "stable-list", limit=3)
        self.sync(
            "after-append",
            2,
            [self.original, {**self.original, "id": "message:appended"}],
        )
        second = self.jobs.result_page("owner", "stable-list", first["nextCursor"], 3)
        third = self.jobs.result_page("owner", "stable-list", second["nextCursor"], 3)
        ids = [item["id"] for page in (first, second, third) for item in page["items"]]
        self.assertEqual(ids, [item["id"] for item in items])
        self.assertIsNone(third["nextCursor"])

    def test_changed_source_invalidates_result_set(self):
        run = self.jobs.create("owner", RunRequest(kind="experiences"))
        self.db.execute(
            "INSERT INTO result_sets(id,owner,run_id,items,created_at) VALUES (?,?,?,?,?)",
            ("changed-list", "owner", run["id"], dumps([{"id": "one"}]), now()),
        )
        self.sync("after-edit", 2, [{**self.original, "text": "روایت ویرایش شد"}])
        with self.assertRaises(AnalyticsError) as raised:
            self.jobs.result_page("owner", "changed-list", limit=3)
        self.assertEqual(raised.exception.status, 409)

    def test_repeated_sensitive_query_with_same_request_key_is_idempotent(self):
        request = RunRequest(
            kind="research", query="تماس 09121234567", requestKey="same-operation"
        )
        first = self.jobs.create("owner", request)
        second = self.jobs.create("owner", request)
        self.assertEqual(first["id"], second["id"])

    def test_long_word_evidence_keeps_the_normalized_selected_phrase(self):
        from analytics.app import _excerpt

        text = "متن مقدماتی آزمایشی " * 130 + "پس از آن بی‌اعتمادی را تجربه کردم"
        quote = _excerpt(text, "بی اعتمادی")
        self.assertIn("بی‌اعتمادی", quote)

    def test_hundred_results_and_small_preview_keep_all_distinct_experiences(self):
        records = [
            {
                **self.original,
                "id": f"message:synthetic-{index:03}",
                "conversationId": f"conversation-{index:03}",
                "text": f"تجربهٔ آزمایشی مستقل شماره {index}",
            }
            for index in range(123)
        ]
        self.sync("many-experiences", 2, records)
        self.jobs.provider = SyntheticExtractionProvider()
        small = self.jobs.create("owner", RunRequest(kind="experiences", limit=3))
        self.jobs.execute(small["id"])
        small = self.jobs.get("owner", small["id"])
        self.assertEqual(small["status"], "completed", small["error"])
        self.assertEqual(len(small["result"]["items"]), 3)
        self.assertEqual(small["result"]["totalFound"], 123)
        first = self.jobs.result_page("owner", small["resultSetId"], limit=100)
        second = self.jobs.result_page(
            "owner", small["resultSetId"], first["nextCursor"], 100
        )
        items = first["items"] + second["items"]
        self.assertEqual(len(first["items"]), 100)
        self.assertEqual(len(second["items"]), 23)
        self.assertEqual(len({item["id"] for item in items}), 123)
        self.assertIsNone(second["nextCursor"])
        with self.assertRaises(AnalyticsError) as raised:
            self.jobs.result_page("other-owner", small["resultSetId"], limit=100)
        self.assertEqual(raised.exception.status, 404)

    def test_cancelling_during_extraction_prevents_completed_results(self):
        outer = self

        class CancelDuringProvider(SyntheticExtractionProvider):
            def json(self, system, data, run_id):
                outer.jobs.cancel("owner", run_id)
                return super().json(system, data, run_id)

        self.jobs.provider = CancelDuringProvider()
        run = self.jobs.create("owner", RunRequest(kind="experiences"))
        self.jobs.execute(run["id"])
        result = self.jobs.get("owner", run["id"])
        self.assertEqual(result["status"], "cancelled")
        self.assertIsNone(result["result"])
        self.assertIsNone(result["resultSetId"])


if __name__ == "__main__":
    unittest.main()
