"""A queued, running or saved analysis cannot outlive a revoked manual."""

import json
import tempfile
import unittest
from pathlib import Path

from analytics.administration import delete_guide, save_guide
from analytics.config import Settings
from analytics.contracts import RunRequest, SyncRequest
from analytics.corpus import Corpus
from analytics.engine import Engine
from analytics.jobs import Jobs
from analytics.storage import Database, dumps, loads


def manual(key="qa-test", version="1", title="QA manual"):
    return {
        "testKey": key,
        "version": version,
        "source": title,
        "scales": {"qa": {"max": 10}},
    }


class NoModelCalls:
    def require_model(self):
        pass

    def complete(self, *_):
        raise AssertionError("A revoked manual must fail before calling the model")


class GuideProvenanceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="crm-guide-provenance-")
        root = Path(self.temp.name)
        self.settings = Settings(guides_dir=str(root / "guides"), worker_enabled=False)
        self.db = Database("sqlite:///" + str(root / "data.sqlite"))
        self.corpus = Corpus(self.db)
        self.jobs = Jobs(self.settings, self.db, self.corpus, NoModelCalls())
        save_guide(self.settings.guides_dir, manual(), True)
        self.corpus.sync(
            SyncRequest.model_validate(
                {
                    "generation": "qa",
                    "snapshotId": "qa",
                    "sequence": 1,
                    "sources": [
                        {
                            "id": "qa",
                            "slug": "qa",
                            "name": "QA",
                            "kind": "test",
                            "platform": "qa",
                        }
                    ],
                    "records": [
                        {
                            "id": "test:one",
                            "kind": "test",
                            "sourceId": "qa",
                            "role": "user",
                            "occurredAt": 100,
                            "text": "پاسخ آزمایشی",
                            "metadata": {
                                "testKey": "qa-test",
                                "testVersion": "1",
                                "scores": {"qa": 8},
                            },
                        }
                    ],
                    "complete": True,
                }
            )
        )

    def tearDown(self):
        self.temp.cleanup()

    def create(self):
        return self.jobs.create("owner", RunRequest(kind="research"))

    def test_run_captures_version_source_and_hash_without_other_manuals(self):
        save_guide(
            self.settings.guides_dir,
            manual("other-test", "2", "unrelated-manual-sentinel"),
            True,
        )
        run = self.create()
        self.assertEqual(run["guideReferences"][0]["testKey"], "qa-test")
        self.assertEqual(run["guideReferences"][0]["version"], "1")
        self.assertEqual(len(run["guideReferences"][0]["sha256"]), 64)
        state = loads(
            self.db.one(
                "SELECT value FROM metadata WHERE key=?", ("run-guides:" + run["id"],)
            )["value"]
        )
        self.assertNotIn("unrelated-manual-sentinel", dumps(state))

    def test_deleted_manual_invalidates_queued_run_before_model_call(self):
        run = self.create()
        delete_guide(self.settings.guides_dir, "qa-test", "1")
        self.assertTrue(self.jobs.get("owner", run["id"])["stale"])
        self.jobs.execute(run["id"])
        failed = self.jobs.get("owner", run["id"])
        self.assertEqual(failed["status"], "failed")
        self.assertEqual(failed["error"]["code"], "dataset_changed")

    def test_replacement_of_deleted_same_version_invalidates_existing_run(self):
        run = self.create()
        delete_guide(self.settings.guides_dir, "qa-test", "1")
        save_guide(self.settings.guides_dir, manual(title="Revised manual"), True)
        self.assertTrue(self.jobs.get("owner", run["id"])["stale"])

    def test_new_unrelated_test_or_version_does_not_invalidate_run(self):
        run = self.create()
        save_guide(self.settings.guides_dir, manual("other-test"), True)
        save_guide(self.settings.guides_dir, manual(version="2"), True)
        self.assertFalse(self.jobs.get("owner", run["id"])["stale"])

    def test_catalog_only_exposes_resolved_manuals_for_selected_versions(self):
        save_guide(
            self.settings.guides_dir,
            manual(version="2", title="unrelated-version-sentinel"),
            True,
        )
        records = self.corpus.records(RunRequest(kind="research").filters)

        class CatalogProvider:
            def __init__(self):
                self.output = None

            def complete(self, messages, *_):
                if self.output is None:
                    self.output = True
                    return {
                        "role": "assistant",
                        "tool_calls": [
                            {
                                "id": "catalog",
                                "function": {
                                    "name": "get_test_catalog",
                                    "arguments": "{}",
                                },
                            }
                        ],
                    }
                self.output = json.loads(messages[-1]["content"])
                return {
                    "content": dumps(
                        {"answer": "راهنمای مرتبط دریافت شد.", "numericClaims": []}
                    )
                }

        provider = CatalogProvider()
        engine = Engine(self.corpus, provider, self.settings)
        engine.research(
            records,
            RunRequest(kind="research"),
            "qa",
            lambda: None,
            lambda *_: None,
            [],
        )
        self.assertEqual(
            [guide["version"] for guide in provider.output["guides"]], ["1"]
        )
        self.assertNotIn("unrelated-version-sentinel", dumps(provider.output))

    def test_manual_deleted_during_model_call_cannot_publish_a_current_result(self):
        directory = self.settings.guides_dir

        class DeleteDuringRun(NoModelCalls):
            calls = 0

            def complete(self, *_):
                self.calls += 1
                if self.calls == 1:
                    delete_guide(directory, "qa-test", "1")
                    return {
                        "role": "assistant",
                        "tool_calls": [
                            {
                                "id": "stats",
                                "function": {
                                    "name": "get_statistics",
                                    "arguments": "{}",
                                },
                            }
                        ],
                    }
                return {
                    "content": dumps(
                        {"answer": "بررسی آماری انجام شد.", "numericClaims": []}
                    )
                }

        self.jobs.provider = DeleteDuringRun()
        run = self.create()
        self.jobs.execute(run["id"])
        result = self.jobs.get("owner", run["id"])
        self.assertTrue(result["stale"])
        self.assertEqual(result["status"], "failed")
        self.assertIsNone(result["result"])
