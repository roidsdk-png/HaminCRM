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


if __name__ == "__main__":
    unittest.main()
