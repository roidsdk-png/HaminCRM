#!/usr/bin/env python3
"""Split legacy web-chat conversations by their stored, pseudonymous IP hash."""

import argparse
import json
import sqlite3
import uuid
from collections import defaultdict
from pathlib import Path


def text(value):
    return value.strip() if isinstance(value, str) and value.strip() else None


def read_payload(raw):
    try:
        value = json.loads(raw)
        return value if isinstance(value, dict) else {}
    except (TypeError, ValueError):
        return {}


def inspect(db):
    messages = db.execute(
        """
        SELECT m.id message_id, m.source_id, m.role, m.content, m.occurred_at,
               c.external_session_id session_id
        FROM messages m
        JOIN conversations c ON c.id=m.conversation_id
        JOIN sources s ON s.id=m.source_id
        WHERE s.kind='chatbot' AND s.platform='eitaa'
        ORDER BY m.occurred_at, m.id
        """
    ).fetchall()
    events = db.execute(
        """
        SELECT e.id, e.source_id, e.occurred_at, e.payload
        FROM ingestion_events e JOIN sources s ON s.id=e.source_id
        WHERE s.kind='chatbot' AND s.platform='eitaa' AND e.type='message.created'
        """
    ).fetchall()
    events_by_id = {row["id"]: row for row in events}
    events_by_legacy_key = defaultdict(list)
    for event in events:
        payload = read_payload(event["payload"])
        key = (event["source_id"], text(payload.get("sessionId")), text(payload.get("role")),
               payload.get("content"), event["occurred_at"])
        events_by_legacy_key[key].append(event)
    groups = defaultdict(list)
    missing_ip = 0
    for row in messages:
        event = events_by_id.get(row["message_id"])
        if not event:
            key = (row["source_id"], row["session_id"], row["role"], row["content"], row["occurred_at"])
            candidates = events_by_legacy_key.get(key, [])
            event = candidates[0] if len(candidates) == 1 else None
        payload = read_payload(event["payload"]) if event else {}
        ip_hash = text(payload.get("ipHash"))
        session_id = text(payload.get("sessionId"))
        if not ip_hash or not session_id:
            missing_ip += 1
            continue
        groups[(row["source_id"], ip_hash, session_id)].append((row, payload))
    return groups, missing_ip


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("database", type=Path)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    db = sqlite3.connect(args.database)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    groups, missing_ip = inspect(db)
    before = {
        "groups": len(groups),
        "messages": sum(len(items) for items in groups.values()),
        "missingIp": missing_ip,
    }
    if not args.apply:
        print(json.dumps({"mode": "dry-run", **before}, ensure_ascii=False))
        return

    indexes = {row["name"] for row in db.execute("PRAGMA index_list('conversations')")}
    if "uq_conversations_source_contact_session" not in indexes:
        raise SystemExit("The contact-aware conversation migration must be applied first")

    created_contacts = 0
    created_conversations = 0
    moved_messages = 0
    expected_assignments = {}
    with db:
        for (source_id, ip_hash, session_id), items in groups.items():
            contact = db.execute(
                "SELECT id FROM contacts WHERE source_id=? AND ip_hash=? LIMIT 1",
                (source_id, ip_hash),
            ).fetchone()
            if contact:
                contact_id = contact["id"]
            else:
                payload = items[0][1]
                contact_id = str(uuid.uuid4())
                occurred = items[0][0]["occurred_at"]
                db.execute(
                    """
                    INSERT INTO contacts
                      (id,source_id,external_user_id,anonymous_id,ip_hash,name,phone,
                       province,city,gender,age,education,metadata,first_seen_at,
                       last_seen_at,created_at,updated_at)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                    """,
                    (
                        contact_id, source_id,
                        text(payload.get("userId")) or text(payload.get("externalUserId")),
                        text(payload.get("anonymousId")), ip_hash, text(payload.get("name")),
                        text(payload.get("phone")), text(payload.get("province")),
                        text(payload.get("city")), text(payload.get("gender")),
                        payload.get("age") if isinstance(payload.get("age"), int) else None,
                        text(payload.get("education")), json.dumps(payload.get("metadata") or {}, ensure_ascii=False),
                        occurred, occurred, occurred, occurred,
                    ),
                )
                created_contacts += 1

            conversation = db.execute(
                """SELECT id FROM conversations
                   WHERE source_id=? AND contact_id=? AND external_session_id=? LIMIT 1""",
                (source_id, contact_id, session_id),
            ).fetchone()
            if conversation:
                conversation_id = conversation["id"]
            else:
                conversation_id = str(uuid.uuid4())
                times = [row["occurred_at"] for row, _ in items]
                db.execute(
                    """
                    INSERT INTO conversations
                      (id,source_id,contact_id,external_session_id,started_at,last_message_at,
                       message_count,created_at,updated_at)
                    VALUES (?,?,?,?,?,?,?,?,?)
                    """,
                    (conversation_id, source_id, contact_id, session_id, min(times), max(times), len(items), min(times), max(times)),
                )
                created_conversations += 1

            for row, _ in items:
                expected_assignments[row["message_id"]] = (contact_id, conversation_id)
                changed = db.execute(
                    "UPDATE messages SET contact_id=?, conversation_id=? WHERE id=? AND (contact_id<>? OR conversation_id<>?)",
                    (contact_id, conversation_id, row["message_id"], contact_id, conversation_id),
                ).rowcount
                moved_messages += changed

        db.execute(
            """
            DELETE FROM conversations
            WHERE source_id IN (SELECT id FROM sources WHERE kind='chatbot' AND platform='eitaa')
              AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id=conversations.id)
            """
        )
        deleted_conversations = db.execute("SELECT changes()").fetchone()[0]
        db.execute(
            """
            UPDATE conversations SET
              message_count=(SELECT COUNT(*) FROM messages m WHERE m.conversation_id=conversations.id),
              started_at=(SELECT MIN(m.occurred_at) FROM messages m WHERE m.conversation_id=conversations.id),
              last_message_at=(SELECT MAX(m.occurred_at) FROM messages m WHERE m.conversation_id=conversations.id),
              updated_at=CAST(strftime('%s','now') AS INTEGER)
            WHERE source_id IN (SELECT id FROM sources WHERE kind='chatbot' AND platform='eitaa')
            """
        )
        db.execute(
            """
            UPDATE contacts SET
              first_seen_at=COALESCE((SELECT MIN(m.occurred_at) FROM messages m WHERE m.contact_id=contacts.id),first_seen_at),
              last_seen_at=COALESCE((SELECT MAX(m.occurred_at) FROM messages m WHERE m.contact_id=contacts.id),last_seen_at),
              updated_at=CAST(strftime('%s','now') AS INTEGER)
            WHERE source_id IN (SELECT id FROM sources WHERE kind='chatbot' AND platform='eitaa')
            """
        )
        db.execute(
            """
            DELETE FROM contacts
            WHERE source_id IN (SELECT id FROM sources WHERE kind='chatbot' AND platform='eitaa')
              AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.contact_id=contacts.id)
              AND NOT EXISTS (SELECT 1 FROM conversations c WHERE c.contact_id=contacts.id)
              AND NOT EXISTS (SELECT 1 FROM test_attempts a WHERE a.contact_id=contacts.id)
              AND NOT EXISTS (SELECT 1 FROM match_profiles p WHERE p.contact_id=contacts.id)
            """
        )
        deleted_contacts = db.execute("SELECT changes()").fetchone()[0]
        db.execute(
            """INSERT INTO audit_logs
               (id,admin_user_id,admin_email,action,entity_type,entity_id,metadata,created_at)
               VALUES (?,?,?,?,?,?,?,CAST(strftime('%s','now') AS INTEGER))""",
            (
                str(uuid.uuid4()), "system:migration", None, "chat.identity.repair", "conversation", None,
                json.dumps({"createdContacts": created_contacts, "createdConversations": created_conversations,
                            "movedMessages": moved_messages, "deletedConversations": deleted_conversations,
                            "deletedContacts": deleted_contacts}, ensure_ascii=False),
            ),
        )

    mixed = db.execute(
        """
        SELECT COUNT(*) FROM (
          SELECT m.conversation_id
          FROM messages m JOIN ingestion_events e ON e.id=m.id
          JOIN sources s ON s.id=m.source_id
          WHERE s.kind='chatbot' AND s.platform='eitaa'
            AND json_extract(e.payload,'$.ipHash') IS NOT NULL
          GROUP BY m.conversation_id
          HAVING COUNT(DISTINCT json_extract(e.payload,'$.ipHash')) > 1
        )
        """
    ).fetchone()[0]
    invalid_assignments = 0
    for message_id, expected in expected_assignments.items():
        saved = db.execute("SELECT contact_id,conversation_id FROM messages WHERE id=?", (message_id,)).fetchone()
        if not saved or (saved["contact_id"], saved["conversation_id"]) != expected:
            invalid_assignments += 1
    print(json.dumps({"mode": "applied", **before, "createdContacts": created_contacts,
                      "createdConversations": created_conversations, "movedMessages": moved_messages,
                      "deletedConversations": deleted_conversations, "deletedContacts": deleted_contacts,
                      "mixedConversationsAfter": mixed, "invalidAssignmentsAfter": invalid_assignments}, ensure_ascii=False))


if __name__ == "__main__":
    main()
