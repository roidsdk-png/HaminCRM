"""Timestamp and transactional storage regressions across both backends."""

import tempfile
import unittest
from pathlib import Path

from analytics.contracts import Filters, SyncRequest
from analytics.corpus import Corpus
from analytics.storage import Database


class StoragePrecisionTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="analysis-storage-")
        self.db = Database(
            "sqlite:///" + str(Path(self.temporary.name) / "precision.sqlite")
        )

    def tearDown(self):
        self.temporary.cleanup()

    def insert_snapshot(self, timestamp):
        self.db.execute(
            "INSERT INTO snapshots(id,generation,sequence,mode,status,sources,started_at,finished_at) VALUES ('precision','qa',1,'full','committed','[]',?,?)",
            (timestamp, timestamp + 0.125),
        )

    def test_epoch_timestamps_preserve_fractional_seconds(self):
        timestamp = 1795293000.375
        self.insert_snapshot(timestamp)
        row = self.db.one("SELECT * FROM snapshots WHERE id='precision'")
        self.assertEqual(row["started_at"], timestamp)
        self.assertEqual(row["finished_at"], timestamp + 0.125)

    def test_postgres_legacy_real_timestamps_are_upgraded_on_reopen(self):
        if not self.db.postgres:
            self.skipTest("Legacy PostgreSQL REAL migration requires PostgreSQL.")
        with self.db.connect(write=True) as connection:
            connection.execute(
                "ALTER TABLE snapshots ALTER COLUMN started_at TYPE REAL"
            )
        reopened = Database(self.db.url)
        column = reopened.one(
            "SELECT data_type FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='snapshots' AND column_name='started_at'"
        )
        self.assertEqual(column["data_type"], "double precision")
        self.insert_snapshot(1795293000.375)
        self.assertEqual(
            reopened.one("SELECT started_at FROM snapshots WHERE id='precision'")[
                "started_at"
            ],
            1795293000.375,
        )

    def test_verified_identity_survives_sync_and_revocation_delta(self):
        corpus = Corpus(self.db)
        sources = [
            {"id": key, "slug": key, "name": key, "kind": "chatbot", "platform": "web"}
            for key in ("chat-source", "test-source")
        ]
        records = [
            {
                "id": "chat-record",
                "kind": "message",
                "sourceId": "chat-source",
                "contactId": "chat-contact",
                "role": "user",
                "occurredAt": 1795293000,
                "text": "روایت ساختگی برای بررسی پیوند تأییدشده",
                "metadata": {"verifiedIdentityId": "qa-verified-identity"},
            },
            {
                "id": "test-record",
                "kind": "test",
                "sourceId": "test-source",
                "contactId": "test-contact",
                "role": "user",
                "occurredAt": 1795293000,
                "metadata": {"verifiedIdentityId": "qa-verified-identity"},
            },
        ]
        corpus.sync(
            SyncRequest.model_validate(
                {
                    "generation": "qa",
                    "snapshotId": "identity-full",
                    "sequence": 1,
                    "sources": sources,
                    "records": records,
                    "complete": True,
                }
            )
        )
        filters = Filters(contactId="chat-contact", includeLinkedContacts=True)
        self.assertEqual(len(corpus.records(filters)), 2)
        self.assertEqual(len(corpus.records(Filters(contactId="chat-contact"))), 1)
        self.assertEqual(
            len(
                corpus.records(
                    filters.model_copy(update={"sourceIds": ["chat-source"]})
                )
            ),
            1,
        )
        records[1]["metadata"] = {}
        corpus.sync(
            SyncRequest.model_validate(
                {
                    "generation": "qa",
                    "snapshotId": "identity-revoked",
                    "sequence": 2,
                    "mode": "delta",
                    "sources": sources,
                    "records": [records[1]],
                    "complete": True,
                }
            )
        )
        self.assertEqual(len(corpus.records(filters)), 1)
