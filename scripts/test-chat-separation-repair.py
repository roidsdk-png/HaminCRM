#!/usr/bin/env python3
"""Regression test for splitting one reused Eitaa session across IP identities."""

import json
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path


def main():
    with tempfile.TemporaryDirectory() as directory:
        database = Path(directory) / "test.sqlite"
        db = sqlite3.connect(database)
        db.executescript(
            """
            CREATE TABLE sources (id TEXT PRIMARY KEY, kind TEXT, platform TEXT);
            CREATE TABLE contacts (id TEXT PRIMARY KEY, source_id TEXT, external_user_id TEXT,
              anonymous_id TEXT, ip_hash TEXT, name TEXT, phone TEXT, province TEXT, city TEXT,
              gender TEXT, age INTEGER, education TEXT, metadata TEXT, first_seen_at INTEGER,
              last_seen_at INTEGER, created_at INTEGER, updated_at INTEGER);
            CREATE UNIQUE INDEX uq_contacts_source_ip ON contacts(source_id,ip_hash);
            CREATE TABLE conversations (id TEXT PRIMARY KEY, source_id TEXT, contact_id TEXT,
              external_session_id TEXT, started_at INTEGER, last_message_at INTEGER,
              message_count INTEGER, created_at INTEGER, updated_at INTEGER);
            CREATE UNIQUE INDEX uq_conversations_source_contact_session
              ON conversations(source_id,contact_id,external_session_id);
            CREATE TABLE messages (id TEXT PRIMARY KEY, source_id TEXT, conversation_id TEXT,
              contact_id TEXT, role TEXT, content TEXT, occurred_at INTEGER);
            CREATE TABLE ingestion_events (id TEXT PRIMARY KEY, source_id TEXT, type TEXT, payload TEXT, occurred_at INTEGER);
            CREATE TABLE test_attempts (id TEXT PRIMARY KEY, contact_id TEXT);
            CREATE TABLE match_profiles (id TEXT PRIMARY KEY, contact_id TEXT);
            CREATE TABLE audit_logs (id TEXT PRIMARY KEY,admin_user_id TEXT,admin_email TEXT,
              action TEXT,entity_type TEXT,entity_id TEXT,metadata TEXT,created_at INTEGER);
            INSERT INTO sources VALUES ('source','chatbot','eitaa');
            INSERT INTO contacts VALUES ('contact-a','source',NULL,'shared-session','ip-a',NULL,NULL,
              NULL,NULL,NULL,NULL,NULL,'{}',100,103,100,103);
            INSERT INTO conversations VALUES ('conversation-a','source','contact-a','shared-session',
              100,103,4,100,103);
            """
        )
        for position, ip_hash in enumerate(("ip-a", "ip-b", "ip-a", "ip-b")):
            message_id = f"message-{position}"
            event_id = message_id if position % 2 == 0 else f"legacy-event-{position}"
            occurred = 100 + position
            role = "user" if position % 2 == 0 else "assistant"
            content = f"content-{position}"
            payload = json.dumps({"sessionId": "shared-session", "anonymousId": "shared-session", "ipHash": ip_hash, "role": role, "content": content})
            db.execute("INSERT INTO messages VALUES (?,?,?,?,?,?,?)", (message_id, "source", "conversation-a", "contact-a", role, content, occurred))
            db.execute("INSERT INTO ingestion_events VALUES (?,?,?,?,?)", (event_id, "source", "message.created", payload, occurred))
        db.commit()
        db.close()

        repair = Path(__file__).with_name("repair-chat-separation.py")
        subprocess.run([sys.executable, str(repair), str(database), "--apply"], check=True)
        db = sqlite3.connect(database)
        assert db.execute("SELECT COUNT(*) FROM contacts").fetchone()[0] == 2
        assert db.execute("SELECT COUNT(*) FROM conversations").fetchone()[0] == 2
        assert db.execute("SELECT COUNT(DISTINCT contact_id) FROM messages").fetchone()[0] == 2
        assert sorted(row[0] for row in db.execute("SELECT message_count FROM conversations")) == [2, 2]
        mixed = db.execute(
            """SELECT COUNT(*) FROM (SELECT conversation_id FROM messages m
               JOIN ingestion_events e ON e.id=m.id GROUP BY conversation_id
               HAVING COUNT(DISTINCT json_extract(e.payload,'$.ipHash')) > 1)"""
        ).fetchone()[0]
        assert mixed == 0
        db.close()
    print("chat separation repair: ok")


if __name__ == "__main__":
    main()
