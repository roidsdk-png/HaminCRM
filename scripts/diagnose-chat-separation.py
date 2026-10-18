import getpass
import json
import textwrap
import uuid

import paramiko


HOST = "5.10.249.198"
DATABASE = "/root/socialCRM/data/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite"

REMOTE = textwrap.dedent(
    f"""
    import json, sqlite3
    db = sqlite3.connect({DATABASE!r})
    db.row_factory = sqlite3.Row
    out = {{}}

    out['sources'] = [dict(r) for r in db.execute('''
      SELECT s.slug, s.name, s.platform,
             COUNT(DISTINCT c.id) contacts,
             COUNT(DISTINCT v.id) conversations,
             COUNT(DISTINCT m.id) messages
      FROM sources s
      LEFT JOIN contacts c ON c.source_id=s.id
      LEFT JOIN conversations v ON v.source_id=s.id
      LEFT JOIN messages m ON m.source_id=s.id
      WHERE s.kind='chatbot'
      GROUP BY s.id ORDER BY s.slug
    ''')]

    out['mixed_conversations'] = [dict(r) for r in db.execute('''
      SELECT s.slug, COUNT(*) mixed_conversations,
             SUM(x.message_count) affected_messages,
             MAX(x.distinct_contacts) max_contacts_in_one_conversation
      FROM (
        SELECT v.id, v.source_id, COUNT(DISTINCT m.contact_id) distinct_contacts,
               COUNT(*) message_count
        FROM conversations v JOIN messages m ON m.conversation_id=v.id
        GROUP BY v.id HAVING COUNT(DISTINCT m.contact_id) > 1
      ) x JOIN sources s ON s.id=x.source_id
      GROUP BY s.id ORDER BY s.slug
    ''')]

    out['contact_mismatch'] = [dict(r) for r in db.execute('''
      SELECT s.slug, COUNT(*) messages
      FROM messages m JOIN conversations v ON v.id=m.conversation_id
      JOIN sources s ON s.id=m.source_id
      WHERE COALESCE(m.contact_id,'') <> COALESCE(v.contact_id,'')
      GROUP BY s.id ORDER BY s.slug
    ''')]

    out['event_identity'] = [dict(r) for r in db.execute('''
      SELECT s.slug,
        COUNT(*) message_events,
        SUM(CASE WHEN json_extract(e.payload,'$.ipHash') IS NOT NULL THEN 1 ELSE 0 END) with_ip,
        COUNT(DISTINCT json_extract(e.payload,'$.ipHash')) distinct_ips,
        COUNT(DISTINCT json_extract(e.payload,'$.anonymousId')) distinct_anonymous,
        COUNT(DISTINCT json_extract(e.payload,'$.sessionId')) distinct_sessions
      FROM ingestion_events e JOIN sources s ON s.id=e.source_id
      WHERE e.type='message.created'
      GROUP BY s.id ORDER BY s.slug
    ''')]

    out['sessions_spanning_ips'] = [dict(r) for r in db.execute('''
      SELECT s.slug, COUNT(*) reused_sessions, SUM(x.events) affected_events,
             MAX(x.ips) max_ips_in_session
      FROM (
        SELECT e.source_id, json_extract(e.payload,'$.sessionId') session_id,
               COUNT(DISTINCT json_extract(e.payload,'$.ipHash')) ips, COUNT(*) events
        FROM ingestion_events e
        WHERE e.type='message.created' AND json_extract(e.payload,'$.ipHash') IS NOT NULL
        GROUP BY e.source_id, session_id HAVING ips > 1
      ) x JOIN sources s ON s.id=x.source_id
      GROUP BY s.id ORDER BY s.slug
    ''')]

    out['ips_spanning_contacts'] = [dict(r) for r in db.execute('''
      SELECT s.slug, COUNT(*) duplicate_ips, SUM(x.contacts) contacts_on_duplicate_ips
      FROM (
        SELECT source_id, ip_hash, COUNT(*) contacts
        FROM contacts WHERE ip_hash IS NOT NULL
        GROUP BY source_id, ip_hash HAVING COUNT(*) > 1
      ) x JOIN sources s ON s.id=x.source_id
      GROUP BY s.id ORDER BY s.slug
    ''')]

    out['legacy_message_matching'] = [dict(r) for r in db.execute('''
      SELECT s.slug, COUNT(*) total_messages,
        SUM(CASE WHEN by_id.id IS NOT NULL THEN 1 ELSE 0 END) matched_by_row_id,
        SUM(CASE WHEN by_external.id IS NOT NULL THEN 1 ELSE 0 END) matched_by_external_id,
        SUM(CASE WHEN by_id.id IS NULL AND by_external.id IS NULL THEN 1 ELSE 0 END) unmatched
      FROM messages m JOIN sources s ON s.id=m.source_id
      LEFT JOIN ingestion_events by_id ON by_id.id=m.id AND by_id.source_id=m.source_id AND by_id.type='message.created'
      LEFT JOIN ingestion_events by_external ON by_external.source_id=m.source_id
        AND by_external.type='message.created'
        AND json_extract(by_external.payload,'$.messageId')=m.external_message_id
      WHERE s.kind='chatbot'
      GROUP BY s.id ORDER BY s.slug
    ''')]

    out['legacy_content_candidates'] = [dict(r) for r in db.execute('''
      WITH candidates AS (
        SELECT m.id, s.slug, COUNT(e.id) candidate_count
        FROM messages m
        JOIN conversations c ON c.id=m.conversation_id
        JOIN sources s ON s.id=m.source_id
        LEFT JOIN ingestion_events direct ON direct.id=m.id AND direct.source_id=m.source_id
        LEFT JOIN ingestion_events e ON e.source_id=m.source_id AND e.type='message.created'
          AND json_extract(e.payload,'$.sessionId')=c.external_session_id
          AND json_extract(e.payload,'$.role')=m.role
          AND json_extract(e.payload,'$.content')=m.content
          AND e.occurred_at=m.occurred_at
        WHERE s.kind='chatbot' AND direct.id IS NULL
        GROUP BY m.id, s.slug
      )
      SELECT slug, COUNT(*) legacy_messages,
        SUM(CASE WHEN candidate_count=1 THEN 1 ELSE 0 END) uniquely_matched,
        SUM(CASE WHEN candidate_count>1 THEN 1 ELSE 0 END) ambiguous,
        SUM(CASE WHEN candidate_count=0 THEN 1 ELSE 0 END) unmatched
      FROM candidates GROUP BY slug ORDER BY slug
    ''')]

    print(json.dumps(out, ensure_ascii=False))
    """
)


def main():
    password = getpass.getpass("SSH password: ")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", password=password, timeout=20)
    try:
        remote_path = f"/tmp/crm-chat-diagnosis-{uuid.uuid4().hex}.py"
        sftp = client.open_sftp()
        with sftp.file(remote_path, "w") as handle:
            handle.write(REMOTE)
        sftp.close()
        _, stdout, stderr = client.exec_command(f"python3 {remote_path}; rm -f {remote_path}", timeout=120)
        error = stderr.read().decode().strip()
        if error:
            raise RuntimeError(error)
        print(json.dumps(json.loads(stdout.read().decode()), ensure_ascii=False, indent=2))
    finally:
        client.close()


if __name__ == "__main__":
    main()
