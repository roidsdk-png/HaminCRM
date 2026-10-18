#!/usr/bin/env python3
"""Read-only aggregate coverage of the central CRM database; no message text."""
from __future__ import annotations

import getpass
import paramiko

DATABASE = "/root/socialCRM/data/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite"
REMOTE = r'''
import sqlite3
db=sqlite3.connect('file:DATABASE?mode=ro',uri=True)
print('SOURCE_TOTALS slug, kind, platform, contacts, conversations, user_messages, assistant_messages, tests, test_answers, matches, match_answers, accepted_events, failed_events, last_event')
for row in db.execute("""SELECT s.slug,s.kind,s.platform,
 (SELECT COUNT(*) FROM contacts c WHERE c.source_id=s.id),
 (SELECT COUNT(*) FROM conversations c WHERE c.source_id=s.id),
 (SELECT COUNT(*) FROM messages m WHERE m.source_id=s.id AND m.role='user'),
 (SELECT COUNT(*) FROM messages m WHERE m.source_id=s.id AND m.role='assistant'),
 (SELECT COUNT(*) FROM test_attempts a WHERE a.source_id=s.id),
 (SELECT COUNT(*) FROM test_answers x JOIN test_attempts a ON a.id=x.attempt_id WHERE a.source_id=s.id),
 (SELECT COUNT(*) FROM match_profiles p WHERE p.source_id=s.id),
 (SELECT COUNT(*) FROM match_answers x JOIN match_profiles p ON p.id=x.profile_id WHERE p.source_id=s.id),
 (SELECT COUNT(*) FROM ingestion_events e WHERE e.source_id=s.id AND e.processing_status='processed'),
 (SELECT COUNT(*) FROM ingestion_events e WHERE e.source_id=s.id AND e.processing_status='failed'),
 (SELECT datetime(MAX(e.received_at),'unixepoch') FROM ingestion_events e WHERE e.source_id=s.id)
 FROM sources s ORDER BY s.slug"""):
 print(*row,sep=' | ')
print('MESSAGE_DATES')
for row in db.execute("SELECT s.slug,MIN(datetime(m.occurred_at,'unixepoch')),MAX(datetime(m.occurred_at,'unixepoch')),COUNT(*) FROM messages m JOIN sources s ON s.id=m.source_id GROUP BY s.slug ORDER BY s.slug"):
 print(*row,sep=' | ')
print('TESTS_WITHOUT_ANSWERS')
for row in db.execute("SELECT s.slug,COUNT(*) FROM test_attempts a JOIN sources s ON s.id=a.source_id WHERE NOT EXISTS (SELECT 1 FROM test_answers x WHERE x.attempt_id=a.id) GROUP BY s.slug ORDER BY s.slug"):
 print(*row,sep=' | ')
print('CHAT_OPTIONAL_FIELDS slug, message_count, model_present, input_tokens_present, output_tokens_present, latency_present, contact_ip_hash_present')
for row in db.execute("""SELECT s.slug,
 (SELECT COUNT(*) FROM messages m WHERE m.source_id=s.id),
 (SELECT COUNT(*) FROM messages m WHERE m.source_id=s.id AND m.model IS NOT NULL),
 (SELECT COUNT(*) FROM messages m WHERE m.source_id=s.id AND m.input_tokens IS NOT NULL),
 (SELECT COUNT(*) FROM messages m WHERE m.source_id=s.id AND m.output_tokens IS NOT NULL),
 (SELECT COUNT(*) FROM messages m WHERE m.source_id=s.id AND m.latency_ms IS NOT NULL),
 (SELECT COUNT(*) FROM contacts c WHERE c.source_id=s.id AND c.ip_hash IS NOT NULL)
 FROM sources s WHERE s.kind='chatbot' ORDER BY s.slug"""):
 print(*row,sep=' | ')
print('FAILED_EVENTS slug, type, error')
for row in db.execute("SELECT s.slug,e.type,e.processing_error FROM ingestion_events e JOIN sources s ON s.id=e.source_id WHERE e.processing_status='failed' ORDER BY e.received_at DESC LIMIT 5"):
 print(*row,sep=' | ')
print('DATABASE',db.execute('PRAGMA integrity_check').fetchone()[0])
db.close()
'''.replace('DATABASE', DATABASE)

def main() -> None:
    password=getpass.getpass('SSH password: ')
    client=paramiko.SSHClient();client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect('5.10.249.198',username='root',password=password,timeout=20)
    try:
        stdin,stdout,stderr=client.exec_command('python3 -',timeout=60)
        stdin.write(REMOTE);stdin.channel.shutdown_write()
        output=stdout.read().decode('utf-8','replace');error=stderr.read().decode('utf-8','replace')
        status=stdout.channel.recv_exit_status();print(output,end='')
        if status!=0:raise RuntimeError(error or f'Coverage check failed: {status}')
    finally:client.close()

if __name__=='__main__':main()
