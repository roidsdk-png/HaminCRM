#!/usr/bin/env python3
"""Deploy dashboard matchmaking trend fix and verify live data consistency."""

import getpass
import hashlib
import posixpath
import shlex
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parents[1]
DEST = '/root/socialCRM'
FILES = ('lib/dashboard-data.ts', 'components/dashboard-charts.tsx', 'app/page.tsx')


def run(client, command, timeout=1800):
    _, stdout, stderr = client.exec_command(command, timeout=timeout)
    output = stdout.read().decode('utf-8', 'replace')
    error = stderr.read().decode('utf-8', 'replace')
    if stdout.channel.recv_exit_status() != 0:
        raise RuntimeError((error or output)[-8000:])
    return output


def digest(sftp, path):
    with sftp.file(path, 'rb') as handle:
        return hashlib.sha256(handle.read()).hexdigest()


def main():
    client = paramiko.SSHClient(); client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect('5.10.249.198', username='root', password=getpass.getpass('SSH password: '), timeout=20)
    backup = ''; changed = False
    try:
        with client.open_sftp() as sftp:
            snapshot = {path: digest(sftp, posixpath.join(DEST, path)) for path in FILES}
            lines = run(client, "set -eu; cd /root/socialCRM; stamp=$(date -u +%Y%m%dT%H%M%SZ); archive=backups/dashboard-match-before-$stamp.tar.gz; tar -czf \"$archive\" " + ' '.join(shlex.quote(path) for path in FILES) + "; test -s \"$archive\"; python3 scripts/backup-production.py; printf '\n%s' \"$archive\"").strip().splitlines()
            backup = lines[-1]
            for path, expected in snapshot.items():
                if digest(sftp, posixpath.join(DEST, path)) != expected:
                    raise RuntimeError(f'Production changed during preflight: {path}')
            for relative in FILES:
                destination = posixpath.join(DEST, relative); temporary = destination + '.match-trend-tmp'
                sftp.put(str(ROOT / relative), temporary); sftp.posix_rename(temporary, destination)
            changed = True

        run(client, 'cd /root/socialCRM && docker compose build crm')
        run(client, 'cd /root/socialCRM && docker compose up -d crm')
        run(client, "for n in $(seq 1 30); do curl -fsS http://127.0.0.1:3010/api/health >/dev/null && exit 0; sleep 3; done; exit 1", timeout=150)
        verification = run(client, """python3 - <<'PY'
import http.cookiejar,json,sqlite3,urllib.request
from pathlib import Path
base='https://crm.haminyar.ir'; cfg={}
for line in Path('/root/socialCRM/.dev.vars').read_text().splitlines():
 if '=' in line and not line.lstrip().startswith('#'):
  k,v=line.split('=',1); cfg[k.strip()]=v.strip().strip(chr(34)+chr(39))
dbs=[path for path in Path('/root/socialCRM/data/v3/d1/miniflare-D1DatabaseObject').glob('*.sqlite') if path.name!='metadata.sqlite']; assert len(dbs)==1, dbs
db=sqlite3.connect(dbs[0]); db.row_factory=sqlite3.Row
source=db.execute("SELECT id,last_seen_at FROM sources WHERE slug='matchhamin' AND status='active'").fetchone(); assert source
profiles=db.execute('SELECT COUNT(*) FROM match_profiles WHERE source_id=?',(source['id'],)).fetchone()[0]
today=db.execute("SELECT COUNT(*) FROM match_profiles WHERE source_id=? AND date(COALESCE(completed_at,created_at),'unixepoch')=date('now')",(source['id'],)).fetchone()[0]
failed=db.execute("SELECT COUNT(*) FROM ingestion_events WHERE processing_status='failed'").fetchone()[0]
integrity=db.execute('PRAGMA integrity_check').fetchone()[0]; db.close()
assert profiles>0 and today>0 and failed==0 and integrity=='ok'
opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
req=urllib.request.Request(base+'/api/admin/auth/login',data=json.dumps({'email':cfg.get('ADMIN_EMAIL',''),'password':cfg['ADMIN_PASSWORD']}).encode(),headers={'Content-Type':'application/json','Origin':base},method='POST'); opener.open(req,timeout=60).read()
dashboard=opener.open(base+'/',timeout=60).read().decode('utf-8','replace')
reports=opener.open(base+'/reports?section=matchmaking',timeout=60).read().decode('utf-8','replace')
assert 'حجم گفتگوها، آزمون‌ها و فرم‌های ازدواج' in dashboard
assert 'فرم کی مناسب ازدواجه تکمیل‌شده' in reports
print('PASS profiles',profiles,'today',today)
print('PASS failed_events',failed,'integrity',integrity)
print('PASS dashboard and filtered reports')
PY""")
        print('DASHBOARD_MATCHMAKING_TREND_OK'); print(verification.strip()); print('Code backup:', backup)
    except Exception:
        if changed and backup:
            run(client, 'cd /root/socialCRM && tar -xzf ' + shlex.quote(backup) + ' && docker compose up -d --build crm')
        raise
    finally:
        client.close()


if __name__ == '__main__': main()
