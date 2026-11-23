"""SQLite migration regressions for the CRM analytics change feed.

All records are synthetic and the database exists only in memory.
"""

import sqlite3
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class ChangeFeedAcceptance(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.execute("PRAGMA foreign_keys=ON")
        for migration in sorted((ROOT / "drizzle").glob("[0-9][0-9][0-9][0-9]_*.sql")):
            self.db.executescript(migration.read_text(encoding="utf-8"))
        self.source = self.db.execute(
            "SELECT id FROM sources ORDER BY id LIMIT 1"
        ).fetchone()[0]
        self.db.execute(
            "INSERT INTO contacts(id,source_id,name,age,created_at,updated_at,first_seen_at,last_seen_at) VALUES(?,?,?,?,1,1,1,1)",
            ("qa-contact", self.source, "QA Contact", 25),
        )
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def sequence(self):
        return self.db.execute(
            "SELECT COALESCE(MAX(sequence),0) FROM analysis_changes"
        ).fetchone()[0]

    def changes(self, since):
        return self.db.execute(
            "SELECT entity,record_id,operation FROM analysis_changes WHERE sequence>? ORDER BY sequence",
            (since,),
        ).fetchall()

    def test_contact_demographic_change_is_in_feed(self):
        initial = self.sequence()
        self.db.execute("UPDATE contacts SET age=26 WHERE id='qa-contact'")
        self.assertEqual(self.changes(initial), [("contact", "qa-contact", "update")])

    def test_verified_identity_membership_and_revocation_change_feed(self):
        self.db.execute(
            "INSERT INTO analysis_identity_groups(id,basis,members_json,verified_by,verified_at) VALUES('group','verified offline','[]','qa',1)"
        )
        initial = self.sequence()
        self.db.execute(
            "INSERT INTO analysis_identity_members(contact_id,group_id) VALUES('qa-contact','group')"
        )
        self.db.execute("DELETE FROM analysis_identity_members WHERE group_id='group'")
        self.assertEqual(
            self.changes(initial),
            [("contact", "qa-contact", "update"), ("contact", "qa-contact", "update")],
        )

    def test_contact_cannot_belong_to_multiple_identity_groups(self):
        for group in ("one", "two"):
            self.db.execute(
                "INSERT INTO analysis_identity_groups(id,basis,members_json,verified_by,verified_at) VALUES(?, 'verified offline','[]','qa',1)",
                (group,),
            )
        self.db.execute(
            "INSERT INTO analysis_identity_members(contact_id,group_id) VALUES('qa-contact','one')"
        )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "INSERT INTO analysis_identity_members(contact_id,group_id) VALUES('qa-contact','two')"
            )

    def test_conversation_contact_change_reexports_fallback_contact_messages(self):
        self.db.execute(
            "INSERT INTO conversations(id,source_id,external_session_id,started_at,last_message_at,created_at,updated_at) VALUES('cv',?,'qa-session',1,1,1,1)",
            (self.source,),
        )
        self.db.execute(
            "INSERT INTO messages(id,source_id,conversation_id,role,content,occurred_at,created_at) VALUES('msg',?,'cv','user','qa',1,1)",
            (self.source,),
        )
        initial = self.sequence()
        self.db.execute(
            "UPDATE conversations SET contact_id='qa-contact' WHERE id='cv'"
        )
        self.assertEqual(self.changes(initial), [("message", "msg", "update")])

    def test_routine_contact_seen_timestamp_does_not_force_reanalysis(self):
        initial = self.sequence()
        self.db.execute(
            "UPDATE contacts SET last_seen_at=100,updated_at=100 WHERE id='qa-contact'"
        )
        self.assertEqual(self.changes(initial), [])

    def test_routine_source_seen_timestamp_does_not_reexport_entire_source(self):
        initial = self.sequence()
        self.db.execute(
            "UPDATE sources SET last_seen_at=100,updated_at=100 WHERE id=?",
            (self.source,),
        )
        self.assertEqual(self.changes(initial), [])

    def test_statistical_exclusion_setting_change_is_in_feed(self):
        initial = self.sequence()
        self.db.execute(
            "INSERT INTO app_settings(key,value,updated_at) VALUES('redline-stat-exclusions','{\"attemptIds\":[\"attempt-one\"]}',100)"
        )
        self.assertEqual(
            self.changes(initial), [("settings", "redline-stat-exclusions", "insert")]
        )

    def test_answer_insert_and_delete_reference_parent_attempt(self):
        self.db.execute(
            "INSERT INTO test_attempts(id,source_id,external_attempt_id,test_key,completed_at,created_at) VALUES('qa-attempt',?,'qa-external','qa-test',100,100)",
            (self.source,),
        )
        initial = self.sequence()
        self.db.execute(
            "INSERT INTO test_answers(id,attempt_id,position,question_text,answer_value,created_at) VALUES('qa-answer','qa-attempt',1,'QA question','QA answer',100)"
        )
        self.db.execute("DELETE FROM test_answers WHERE id='qa-answer'")
        self.assertEqual(
            self.changes(initial),
            [("test", "qa-attempt", "insert"), ("test", "qa-attempt", "delete")],
        )

    def test_rolled_back_change_does_not_advance_committed_feed(self):
        initial = self.sequence()
        self.db.execute("UPDATE contacts SET age=80 WHERE id='qa-contact'")
        self.db.rollback()
        self.assertEqual(self.changes(initial), [])
        self.assertEqual(
            self.db.execute(
                "SELECT age FROM contacts WHERE id='qa-contact'"
            ).fetchone()[0],
            25,
        )

    def insert_event(self, identifier, kind, payload, status):
        self.db.execute(
            "INSERT INTO ingestion_events(id,source_id,external_event_id,type,payload,occurred_at,received_at,processing_status) VALUES(?,?,?,?,?,1,1,?)",
            (identifier, self.source, identifier, kind, payload, status),
        )

    def test_pending_ingestion_lookup_uses_partial_index(self):
        query = """SELECT a.id FROM test_attempts a WHERE NOT EXISTS (
            SELECT 1 FROM ingestion_events event
            WHERE event.source_id=a.source_id AND event.type='test.completed'
              AND json_extract(event.payload,'$.attemptId')=a.external_attempt_id
              AND event.processing_status <> 'processed')"""
        details = [row[3] for row in self.db.execute("EXPLAIN QUERY PLAN " + query)]
        self.assertTrue(
            any(
                "USING INDEX idx_ingestion_unprocessed_source_type" in row
                for row in details
            ),
            details,
        )
        self.assertFalse(any("SCAN event" in row for row in details), details)

    def test_processed_history_is_not_parsed_and_pending_completion_still_blocks(self):
        self.db.execute(
            "INSERT INTO test_attempts(id,source_id,external_attempt_id,test_key,completed_at,created_at) VALUES('qa-pending-attempt',?,'external-target','qa-test',1,1)",
            (self.source,),
        )
        query = """SELECT a.id FROM test_attempts a WHERE NOT EXISTS (
            SELECT 1 FROM ingestion_events event
            WHERE event.source_id=a.source_id AND event.type='test.completed'
              AND json_extract(event.payload,'$.attemptId')=a.external_attempt_id
              AND event.processing_status <> 'processed')"""
        # Processed transport history can be large and is irrelevant to readiness.
        # A malformed legacy value must never be parsed by this pending-only lookup.
        self.insert_event(
            "old-processed", "test.completed", "legacy non-JSON value", "processed"
        )
        self.insert_event(
            "different-pending", "test.completed", '{"attemptId":"another"}', "received"
        )
        self.assertEqual(self.db.execute(query).fetchall(), [("qa-pending-attempt",)])
        self.insert_event(
            "target-pending",
            "test.completed",
            '{"attemptId":"external-target"}',
            "received",
        )
        self.assertEqual(self.db.execute(query).fetchall(), [])
        self.db.execute(
            "UPDATE ingestion_events SET processing_status='failed' WHERE id='target-pending'"
        )
        self.assertEqual(self.db.execute(query).fetchall(), [])
        self.db.execute(
            "UPDATE ingestion_events SET processing_status='processed' WHERE id='target-pending'"
        )
        self.assertEqual(self.db.execute(query).fetchall(), [("qa-pending-attempt",)])

    def test_pending_match_lookup_preserves_attempt_number(self):
        self.db.execute(
            "INSERT INTO match_profiles(id,source_id,external_profile_id,attempt_number,profile,completed_at,created_at) VALUES('qa-pending-match',?,'external-profile',2,'{}',1,1)",
            (self.source,),
        )
        query = """SELECT p.id FROM match_profiles p WHERE NOT EXISTS (
            SELECT 1 FROM ingestion_events event WHERE event.source_id=p.source_id
              AND event.type='matchmaking.profile.completed'
              AND json_extract(event.payload,'$.profileId')=p.external_profile_id
              AND event.processing_status <> 'processed'
              AND COALESCE(json_extract(event.payload,'$.attemptNumber'),1)=p.attempt_number)"""
        details = [row[3] for row in self.db.execute("EXPLAIN QUERY PLAN " + query)]
        self.assertTrue(
            any("idx_ingestion_unprocessed_source_type" in row for row in details),
            details,
        )
        self.insert_event(
            "older-match",
            "matchmaking.profile.completed",
            '{"profileId":"external-profile","attemptNumber":1}',
            "failed",
        )
        self.assertEqual(self.db.execute(query).fetchall(), [("qa-pending-match",)])
        self.insert_event(
            "current-match",
            "matchmaking.profile.completed",
            '{"profileId":"external-profile","attemptNumber":2}',
            "received",
        )
        self.assertEqual(self.db.execute(query).fetchall(), [])
        self.db.execute(
            "UPDATE ingestion_events SET processing_status='processed' WHERE id='current-match'"
        )
        self.assertEqual(self.db.execute(query).fetchall(), [("qa-pending-match",)])


if __name__ == "__main__":
    unittest.main()
