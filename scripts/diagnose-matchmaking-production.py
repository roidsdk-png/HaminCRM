#!/usr/bin/env python3
"""Read-only consistency check for matchmaking ingestion and report dates."""

import getpass
import paramiko

DATABASE = "/root/socialCRM/data/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite"
REMOTE = r'''
import sqlite3
db=sqlite3.connect('file:DATABASE?mode=ro',uri=True)
db.row_factory=sqlite3.Row
source=db.execute("SELECT id,slug,name,status,datetime(last_seen_at,'unixepoch') last_seen FROM sources WHERE slug='matchhamin'").fetchone()
print('SOURCE',dict(source) if source else None)
if source:
 sid=source['id']
 print('EVENT_TYPES_7D')
 for row in db.execute("""SELECT type,processing_status,COUNT(*) count,datetime(MAX(received_at),'unixepoch') last_received
 FROM ingestion_events WHERE source_id=? AND received_at>=unixepoch('now','-7 day') GROUP BY type,processing_status ORDER BY count DESC""",(sid,)): print(dict(row))
 print('RECEIVED_DAILY_14D')
 for row in db.execute("""SELECT date(received_at,'unixepoch') day,COUNT(*) events,COUNT(DISTINCT external_event_id) unique_events,
 SUM(CASE WHEN processing_status='failed' THEN 1 ELSE 0 END) failed
 FROM ingestion_events WHERE source_id=? AND received_at>=unixepoch('now','-14 day') GROUP BY day ORDER BY day""",(sid,)): print(dict(row))
 print('PROFILE_DAILY_14D')
 for row in db.execute("""SELECT date(COALESCE(completed_at,created_at),'unixepoch') day,COUNT(*) profiles,
 SUM(CASE WHEN completed_at IS NULL THEN 1 ELSE 0 END) incomplete
 FROM match_profiles WHERE source_id=? AND COALESCE(completed_at,created_at)>=unixepoch('now','-14 day') GROUP BY day ORDER BY day""",(sid,)): print(dict(row))
 print('LATEST_PROFILES')
 for row in db.execute("""SELECT external_profile_id,attempt_number,datetime(created_at,'unixepoch') created_at,
 datetime(completed_at,'unixepoch') completed_at,(SELECT COUNT(*) FROM match_answers a WHERE a.profile_id=p.id) answers
 FROM match_profiles p WHERE source_id=? ORDER BY COALESCE(completed_at,created_at) DESC LIMIT 10""",(sid,)): print(dict(row))
 print('DUPLICATES',db.execute("SELECT COUNT(*) FROM (SELECT external_profile_id,attempt_number,COUNT(*) n FROM match_profiles WHERE source_id=? GROUP BY external_profile_id,attempt_number HAVING n>1)",(sid,)).fetchone()[0])
 print('ORPHAN_ANSWERS',db.execute("SELECT COUNT(*) FROM match_answers a LEFT JOIN match_profiles p ON p.id=a.profile_id WHERE p.id IS NULL").fetchone()[0])
 print('CONTACTLESS',db.execute("SELECT COUNT(*) FROM match_profiles WHERE source_id=? AND contact_id IS NULL",(sid,)).fetchone()[0])
 print('DB',db.execute('PRAGMA integrity_check').fetchone()[0])
db.close()
'''.replace('DATABASE', DATABASE)


def main():
    client=paramiko.SSHClient(); client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect('5.10.249.198',username='root',password=getpass.getpass('SSH password: '),timeout=20)
    try:
        stdin,stdout,stderr=client.exec_command('python3 -',timeout=60)
        stdin.write(REMOTE); stdin.channel.shutdown_write()
        output=stdout.read().decode('utf-8','replace'); error=stderr.read().decode('utf-8','replace')
        status=stdout.channel.recv_exit_status(); print(output,end='')
        if status: raise RuntimeError(error or f'check failed: {status}')
    finally: client.close()


if __name__=='__main__': main()
