"""Corpus retention regressions use temporary SQLite databases and synthetic text."""

import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch

from analytics.contracts import SyncRequest
from analytics.corpus import Corpus
from analytics.retention import cleanup_snapshots
from analytics.storage import Database


class SnapshotRetentionTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="analytics-retention-")
        self.db = Database(
            "sqlite:///" + str(Path(self.temporary.name) / "retention.sqlite")
        )

    def tearDown(self):
        self.temporary.cleanup()

    def snapshot(self, identifier, status="committed", started_at=100, count=2):
        with self.db.connect(write=True) as connection:
            connection.execute(
                "INSERT INTO snapshots(id,generation,sequence,mode,status,sources,started_at,finished_at) VALUES (?,'qa',1,'full',?,'[]',?,?)",
                (identifier, status, started_at, started_at),
            )
            for index in range(count):
                connection.execute(
                    "INSERT INTO records(snapshot_id,id,kind,source_id,contact_id,conversation_id,role,occurred_at,text,metadata,content_hash) VALUES (?,?,'message','qa-source','qa-person','qa-chat','user',100,'Synthetic QA text','{}','qa-hash')",
                    (identifier, f"message:{index}"),
                )

    def active(self, identifier):
        self.db.execute(
            "INSERT INTO metadata(key,value) VALUES ('active_snapshot',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (identifier,),
        )

    def job(self, identifier, snapshot_id, status):
        self.db.execute(
            "INSERT INTO runs(id,owner,kind,request,snapshot_id,status,created_at,updated_at) VALUES (?,'qa-owner','research','{}',?,?,100,100)",
            (identifier, snapshot_id, status),
        )

    def count(self, table, snapshot_id=None):
        if snapshot_id is None:
            return self.db.one(f"SELECT COUNT(*) total FROM {table}")["total"]
        return self.db.one(
            f"SELECT COUNT(*) total FROM {table} WHERE snapshot_id=?", (snapshot_id,)
        )["total"]

    def cleanup(self, seconds=3600):
        with patch("analytics.retention.now", return_value=10_000):
            return cleanup_snapshots(self.db, max_age_seconds=seconds)

    def test_committed_text_is_pruned_but_report_metadata_remains(self):
        self.snapshot("old", started_at=9999)
        self.snapshot("active", count=3)
        self.active("active")
        self.job("completed-report", "old", "completed")

        result = self.cleanup()

        self.assertEqual(result["prunedRecords"], 2)
        self.assertEqual(self.count("records", "old"), 0)
        self.assertEqual(self.count("records", "active"), 3)
        self.assertEqual(self.count("snapshots"), 2)
        self.assertIsNotNone(self.db.one("SELECT id FROM snapshots WHERE id='old'"))
        self.assertEqual(self.count("runs"), 1)

    def test_queued_and_running_jobs_pin_their_full_snapshot(self):
        for status in ["queued", "running", "completed", "failed", "cancelled"]:
            self.snapshot(status)
            self.job("job-" + status, status, status)
        self.snapshot("active")
        self.active("active")

        self.cleanup()

        self.assertEqual(self.count("records", "queued"), 2)
        self.assertEqual(self.count("records", "running"), 2)
        self.assertEqual(self.count("records", "active"), 2)
        for status in ["completed", "failed", "cancelled"]:
            self.assertEqual(self.count("records", status), 0)
        self.assertEqual(self.count("snapshots"), 6)

    def test_expired_staging_is_removed_at_the_age_boundary(self):
        self.snapshot("expired", status="preparing", started_at=6400)
        self.snapshot("recent", status="preparing", started_at=6401)
        self.snapshot("active")
        self.active("active")

        result = self.cleanup()

        self.assertEqual(result["removedPreparingRecords"], 2)
        self.assertEqual(result["removedPreparingSnapshots"], 1)
        self.assertIsNone(self.db.one("SELECT id FROM snapshots WHERE id='expired'"))
        self.assertEqual(self.count("records", "recent"), 2)
        self.assertEqual(self.count("records", "active"), 2)

    def test_active_and_open_jobs_protect_even_expired_staging(self):
        self.snapshot("active", status="preparing")
        self.snapshot("queued", status="preparing")
        self.snapshot("running", status="preparing")
        self.active("active")
        self.job("queued-job", "queued", "queued")
        self.job("running-job", "running", "running")

        result = self.cleanup()

        self.assertEqual(self.count("records"), 6)
        self.assertEqual(self.count("snapshots"), 3)
        self.assertEqual(result["removedPreparingSnapshots"], 0)

    def test_many_commits_keep_one_full_corpus_and_all_snapshot_metadata(self):
        corpus = Corpus(self.db)
        for sequence in range(1, 21):
            corpus.sync(
                SyncRequest.model_validate(
                    {
                        "generation": "qa",
                        "snapshotId": f"snapshot-{sequence}",
                        "sequence": sequence,
                        "sources": [
                            {
                                "id": "qa",
                                "slug": "qa",
                                "name": "QA",
                                "kind": "chatbot",
                                "platform": "bale",
                            }
                        ],
                        "records": [
                            {
                                "id": f"message:{index}",
                                "sourceId": "qa",
                                "kind": "message",
                                "role": "user",
                                "occurredAt": 100,
                                "text": "Synthetic QA text",
                            }
                            for index in range(3)
                        ],
                        "complete": True,
                    }
                )
            )
            self.cleanup()
            self.assertEqual(self.count("records"), 3)

        self.assertEqual(self.count("snapshots"), 20)
        self.assertEqual(self.db.active_snapshot()["id"], "snapshot-20")

    def test_cleanup_is_idempotent(self):
        self.snapshot("old")
        self.snapshot("expired", status="preparing")
        self.snapshot("active")
        self.active("active")
        self.cleanup()

        self.assertEqual(
            self.cleanup(),
            {
                "prunedRecords": 0,
                "removedPreparingRecords": 0,
                "removedPreparingSnapshots": 0,
            },
        )

    def test_all_deletions_roll_back_when_metadata_removal_fails(self):
        self.snapshot("old")
        self.snapshot("expired", status="preparing")
        self.snapshot("active")
        self.active("active")
        original_connect = self.db.connect

        @contextmanager
        def failed_transaction(write=False):
            with original_connect(write=write) as connection:
                original_execute = connection.execute

                def execute(sql, params=()):
                    if sql.startswith("DELETE FROM snapshots"):
                        raise RuntimeError("Synthetic metadata deletion failure")
                    return original_execute(sql, params)

                with patch.object(connection, "execute", side_effect=execute):
                    yield connection

        with patch.object(self.db, "connect", side_effect=failed_transaction):
            with self.assertRaises(RuntimeError):
                self.cleanup()

        self.assertEqual(self.count("records"), 6)
        self.assertEqual(self.count("snapshots"), 3)

    def test_invalid_retention_never_mutates_data(self):
        self.snapshot("old")
        for value in [-1, float("inf"), float("nan"), True, "3600"]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.cleanup(value)
        self.assertEqual(self.count("records"), 2)

    def test_postgres_advisory_lock_is_taken_before_deletion(self):
        self.snapshot("old")
        underlying = self.db
        statements = []

        class AdvisoryDatabase:
            postgres = True

            @contextmanager
            def connect(self, write=False):
                with underlying.connect(write=write) as connection:
                    original_execute = connection.execute

                    def execute(sql, params=()):
                        statements.append(sql.strip())
                        if sql.startswith("SELECT pg_advisory_xact_lock"):
                            return None
                        return original_execute(sql, params)

                    with patch.object(connection, "execute", side_effect=execute):
                        yield connection

        cleanup_snapshots(AdvisoryDatabase())

        self.assertEqual(statements[0], "SELECT pg_advisory_xact_lock(7284511)")
        self.assertEqual(self.count("records"), 0)


if __name__ == "__main__":
    unittest.main()
