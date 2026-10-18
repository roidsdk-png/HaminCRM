#!/usr/bin/env python3
from __future__ import annotations

import getpass
import paramiko

HOST = "5.10.249.198"
DATABASE = "/root/socialCRM/data/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite"

REMOTE = r'''
import sqlite3
from datetime import datetime, timedelta, timezone

db = sqlite3.connect('file:DATABASE?mode=ro', uri=True)
today = datetime.now(timezone.utc).date()
from_day = today - timedelta(days=29)
print('UTC_RANGE', from_day, today)
print('TOTAL_TESTS', db.execute('SELECT COUNT(*) FROM test_attempts').fetchone()[0])
print('LAST_30_TESTS', db.execute("SELECT COUNT(*) FROM test_attempts WHERE date(completed_at,'unixepoch') BETWEEN ? AND ?", (str(from_day),str(today))).fetchone()[0])
print('TESTS_BY_SOURCE')
for row in db.execute("SELECT s.slug,COUNT(*),SUM(CASE WHEN date(a.completed_at,'unixepoch') BETWEEN ? AND ? THEN 1 ELSE 0 END),MIN(date(a.completed_at,'unixepoch')),MAX(date(a.completed_at,'unixepoch')) FROM test_attempts a JOIN sources s ON s.id=a.source_id GROUP BY s.slug ORDER BY COUNT(*) DESC", (str(from_day),str(today))):
    print(*row)
print('LAST_30_CARDS')
for table, field in [('contacts','first_seen_at'),('conversations','started_at'),('messages','occurred_at'),('match_profiles','completed_at')]:
    print(table, *db.execute(f"SELECT COUNT(*),SUM(CASE WHEN date({field},'unixepoch') BETWEEN ? AND ? THEN 1 ELSE 0 END) FROM {table}", (str(from_day),str(today))).fetchone())
print('DB_INTEGRITY', db.execute('PRAGMA integrity_check').fetchone()[0])
db.close()
import http.cookiejar
import json
import urllib.request
from pathlib import Path
env = {}
for raw in Path('/root/socialCRM/.dev.vars').read_text().splitlines():
    if '=' in raw and not raw.lstrip().startswith('#'):
        key, value = raw.split('=', 1)
        env[key.strip()] = value.strip().strip('"\'')
client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
base = 'https://crm.haminyar.ir'
payload = json.dumps({'email': env.get('ADMIN_EMAIL',''), 'password': env['ADMIN_PASSWORD']}).encode()
login = urllib.request.Request(base+'/api/admin/auth/login', data=payload, headers={'Content-Type':'application/json','Origin':base}, method='POST')
with client.open(login, timeout=30) as response:
    print('LOGIN', response.status)
for path in ['/reports', '/reports?from=2026-04-01&to=2026-09-15', '/reports?source=psytest-1&from=2026-08-17&to=2026-09-15']:
    with client.open(base+path, timeout=30) as response:
        page = response.read().decode('utf-8')
        needle = 'آزمون‌های تکمیل‌شده'
        at = page.find(needle)
        print('PAGE', path, response.status, 'label_found', at>=0, 'snippet', page[max(0,at-150):at+700].replace('\n',' ')[:850])
'''.replace('DATABASE', DATABASE)

def main() -> None:
    password = getpass.getpass("SSH password: ")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", password=password, timeout=20)
    try:
        stdin, stdout, stderr = client.exec_command("python3 -", timeout=60)
        stdin.write(REMOTE)
        stdin.channel.shutdown_write()
        output = stdout.read().decode("utf-8", "replace")
        error = stderr.read().decode("utf-8", "replace")
        status = stdout.channel.recv_exit_status()
        print(output, end="")
        if status != 0:
            raise RuntimeError(error or f"Remote diagnostic failed: {status}")
    finally:
        client.close()

if __name__ == "__main__":
    main()
