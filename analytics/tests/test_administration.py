"""Owner-managed resources and verified contact scope, using isolated local data."""

import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from analytics.administration import delete_guide, lexicon, save_guide, save_lexicon
from analytics.app import create_app
from analytics.config import Settings
from analytics.contracts import Filters, SyncRequest
from analytics.corpus import Corpus, matches
from analytics.guides import load_guides
from analytics.storage import AnalyticsError, Database


class AdministrationAcceptance(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="crm-admin-")
        self.root = Path(self.temp.name)
        self.db = Database("sqlite:///" + str(self.root / "data.sqlite"))
        self.guides = self.root / "guides"

    def tearDown(self):
        self.temp.cleanup()

    def guide(self):
        return {
            "testKey": "synthetic-test",
            "version": "1",
            "source": {"title": "Synthetic manual"},
            "scoring": {"range": [0, 10]},
        }

    def test_lexicon_normalizes_and_persists_empty_override(self):
        initial = lexicon(self.db, {"سلام"})
        saved = save_lexicon(self.db, ["كتاب", "کتاب", "  خانواده  "])
        self.assertEqual(saved["stopwords"], ["خانواده", "کتاب"])
        self.assertNotEqual(initial["version"], saved["version"])
        save_lexicon(self.db, [])
        self.assertEqual(lexicon(self.db, {"سلام"})["stopwords"], [])

    def test_guide_requires_explicit_confirmation_and_valid_manual(self):
        for guide, confirmed in [
            (self.guide(), False),
            ({"testKey": "x", "version": "1", "source": "manual"}, True),
        ]:
            with self.assertRaises(AnalyticsError):
                save_guide(self.guides, guide, confirmed)
        self.assertFalse(self.guides.exists())

    def test_guide_import_is_idempotent_and_conflicting_version_is_rejected(self):
        guide = self.guide()
        save_guide(self.guides, guide, True)
        save_guide(self.guides, dict(reversed(list(guide.items()))), True)
        self.assertEqual(len(list(self.guides.glob("*.json"))), 1)
        with self.assertRaises(AnalyticsError) as error:
            save_guide(self.guides, {**guide, "scoring": {"range": [0, 20]}}, True)
        self.assertEqual(error.exception.code, "guide_version_conflict")

    def test_guide_paths_cannot_escape_directory(self):
        guide = {**self.guide(), "testKey": "../../outside", "version": "../x"}
        save_guide(self.guides, guide, True)
        self.assertEqual(len(list(self.guides.glob("managed-*.json"))), 1)
        self.assertFalse((self.root / "outside").exists())
        delete_guide(self.guides, guide["testKey"], guide["version"])
        self.assertEqual(load_guides(self.guides), {})

    def test_external_configuration_files_are_not_deleted(self):
        self.guides.mkdir()
        external = self.guides / "manual.json"
        external.write_text(__import__("json").dumps(self.guide()), encoding="utf-8")
        with self.assertRaises(AnalyticsError):
            delete_guide(self.guides, "synthetic-test", "1")
        self.assertTrue(external.exists())

    def test_private_resource_api_auth_and_validation(self):
        with TestClient(
            create_app(
                Settings(
                    database_url=self.db.url,
                    internal_token="local-synthetic-token",
                    worker_enabled=False,
                    guides_dir=str(self.guides),
                )
            )
        ) as client:
            headers = {
                "Authorization": "Bearer local-synthetic-token",
                "X-Analytics-Actor": "owner",
            }
            for path in ("lexicon", "guides", "config"):
                self.assertEqual(client.get("/v1/" + path).status_code, 401)
            self.assertEqual(
                client.post(
                    "/v1/lexicon", headers=headers, json={"stopwords": ["x" * 101]}
                ).status_code,
                422,
            )
            self.assertEqual(
                client.post(
                    "/v1/lexicon", headers=headers, json={"stopwords": []}
                ).status_code,
                200,
            )
            self.assertEqual(
                client.post(
                    "/v1/guides",
                    headers=headers,
                    json={"guide": self.guide(), "confirmed": True},
                ).status_code,
                200,
            )
            self.assertEqual(
                client.get("/v1/guides", headers=headers).json()["guides"][0][
                    "testKey"
                ],
                "synthetic-test",
            )
            self.assertEqual(
                client.delete(
                    "/v1/guides?testKey=synthetic-test&version=1", headers=headers
                ).status_code,
                200,
            )
            config = client.get("/v1/config", headers=headers).json()
            self.assertEqual(config["usage"]["calls"], 0)
            self.assertNotIn("api_key", config)

    def corpus(self):
        corpus = Corpus(self.db)
        sources = [
            {
                "id": source,
                "slug": source,
                "name": source,
                "kind": "chatbot",
                "platform": "test",
            }
            for source in ("a", "b", "c")
        ]
        records = [
            {
                "id": source,
                "kind": "message",
                "sourceId": source,
                "contactId": "person-" + source,
                "conversationId": "chat-" + source,
                "role": "user",
                "occurredAt": 1,
                "text": "خانواده خانواده ازدواج",
                "metadata": {
                    "verifiedIdentityId": "verified-group"
                    if source in ("a", "b")
                    else None
                },
            }
            for source in ("a", "b", "c")
        ]
        corpus.sync(
            SyncRequest(
                generation="qa",
                snapshotId="one",
                sequence=1,
                complete=True,
                sources=sources,
                records=records,
            )
        )
        return corpus

    def test_linked_contact_scope_is_explicit_and_obeys_other_filters(self):
        corpus = self.corpus()
        self.assertEqual(
            [r["id"] for r in corpus.records(Filters(contactId="person-a"))], ["a"]
        )
        self.assertEqual(
            [
                r["id"]
                for r in corpus.records(
                    Filters(contactId="person-a", includeLinkedContacts=True)
                )
            ],
            ["a", "b"],
        )
        self.assertEqual(
            [
                r["id"]
                for r in corpus.records(
                    Filters(
                        contactId="person-a",
                        includeLinkedContacts=True,
                        sourceIds=["b"],
                    )
                )
            ],
            ["b"],
        )
        self.assertEqual(
            [
                r["id"]
                for r in corpus.records(
                    Filters(contactId="person-c", includeLinkedContacts=True)
                )
            ],
            ["c"],
        )

    def test_word_metrics_and_custom_exclusion_preserve_raw_text(self):
        corpus = self.corpus()
        save_lexicon(self.db, ["خانواده"])
        words = corpus.words(Filters(), metric="occurrences")
        self.assertEqual(words["metric"], "occurrences")
        self.assertNotIn("خانواده", [item["term"] for item in words["items"]])
        self.assertIn("خانواده", corpus.records(Filters())[0]["text"])

    def test_word_evidence_is_private_and_does_not_pollute_report_history(self):
        self.corpus()
        settings = Settings(
            database_url=self.db.url,
            internal_token="synthetic-token",
            worker_enabled=False,
        )
        with TestClient(create_app(settings)) as client:
            headers = {
                "Authorization": "Bearer synthetic-token",
                "X-Analytics-Actor": "owner",
            }
            result = client.get("/v1/word-evidence?term=خانواده", headers=headers)
            self.assertEqual(result.status_code, 200)
            self.assertTrue(result.json()["items"])
            self.assertEqual(
                client.get("/v1/runs", headers=headers).json()["items"], []
            )
            other = {**headers, "X-Analytics-Actor": "another-owner"}
            self.assertEqual(
                client.get(
                    "/v1/evidence/" + result.json()["items"][0]["id"], headers=other
                ).status_code,
                404,
            )

    def test_score_filters_reject_boolean_and_invalid_ranges(self):
        corpus = self.corpus()
        record = corpus.records(Filters())[0]
        record["metadata"]["scores"] = {"scale": True}
        self.assertFalse(matches(record, Filters(scoreKey="scale", scoreFrom=0)))
        for filters in (
            Filters(scoreFrom=0),
            Filters(scoreKey="scale", scoreFrom=9, scoreTo=2),
        ):
            with self.assertRaises(AnalyticsError):
                corpus.records(filters)


if __name__ == "__main__":
    unittest.main()
