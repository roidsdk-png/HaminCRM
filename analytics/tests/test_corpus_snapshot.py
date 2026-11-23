"""Counts and their snapshot label come from the same atomic database read."""

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from analytics.config import Settings
from analytics.contracts import Filters, SyncRequest
from analytics.corpus import Corpus
from analytics.retention import cleanup_snapshots
from analytics.storage import Database


class CorpusSnapshotTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="crm-corpus-snapshot-")
        self.db = Database("sqlite:///" + str(Path(self.temp.name) / "data.sqlite"))
        self.corpus = Corpus(self.db)

    def tearDown(self):
        self.temp.cleanup()

    def sync(self, identifier, sequence, text="", identities=()):
        self.corpus.sync(
            SyncRequest.model_validate(
                {
                    "generation": "qa",
                    "snapshotId": identifier,
                    "sequence": sequence,
                    "sources": [
                        {
                            "id": identifier,
                            "slug": identifier,
                            "name": identifier,
                            "kind": "chatbot",
                            "platform": "qa",
                        }
                    ],
                    "records": [
                        {
                            "id": f"message:{identifier}:{index}",
                            "kind": "message",
                            "sourceId": identifier,
                            "contactId": f"contact:{index}",
                            "role": "user",
                            "occurredAt": 100,
                            "text": text,
                            "metadata": {"verifiedIdentityId": identity},
                        }
                        for index, identity in enumerate(identities)
                    ],
                    "complete": True,
                }
            )
        )

    def test_overview_never_uses_an_independent_pointer_read(self):
        self.sync("old", 1, "قدیمی", ["identity"])
        original_all = self.db.all
        switched = False

        def before_read(sql, params=()):
            nonlocal switched
            if not switched and "FROM snapshots s LEFT JOIN records" in sql:
                switched = True
                self.sync("new", 2, "جدید", ["verified", "verified"])
                cleanup_snapshots(self.db)
            return original_all(sql, params)

        with (
            patch.object(self.db, "all", side_effect=before_read),
            patch.object(
                self.db,
                "active_snapshot",
                side_effect=AssertionError(
                    "Separate pointer lookup can race retention"
                ),
            ),
        ):
            result = self.corpus.overview(Filters(), Settings())
        self.assertTrue(switched)
        self.assertEqual(result["dataset"]["snapshotId"], "new")
        self.assertEqual(result["sources"][0]["id"], "new")
        self.assertEqual(result["totals"]["records"], 2)
        self.assertEqual(result["totals"]["verifiedIdentities"], 1)
        self.assertEqual(result["totals"]["linkedContacts"], 2)

    def test_empty_snapshot_still_has_its_header_and_sources(self):
        self.sync("empty", 1)
        result = self.corpus.overview(Filters(), Settings())
        self.assertEqual(result["dataset"]["snapshotId"], "empty")
        self.assertEqual(result["sources"][0]["id"], "empty")
        self.assertEqual(result["totals"]["records"], 0)

    def test_filtered_empty_result_keeps_the_captured_snapshot(self):
        self.sync("filtered", 1, "متن", [None])
        result = self.corpus.overview(Filters(sourceIds=["different"]), Settings())
        self.assertEqual(result["dataset"]["snapshotId"], "filtered")
        self.assertEqual(result["totals"]["records"], 0)

    def test_unsynced_dataset_has_no_snapshot(self):
        records, snapshot = self.corpus.records(Filters(), with_snapshot=True)
        self.assertEqual(records, [])
        self.assertIsNone(snapshot)
