#!/usr/bin/env python3
"""Deploy theme-aware chart contrast improvements with rollback protection."""

import getpass
import hashlib
import posixpath
import shlex
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parents[1]
DEST = '/root/socialCRM'
FILES = ('app/globals.css', 'components/dashboard-charts.tsx')


def run(client, command, timeout=1800):
    _, stdout, stderr = client.exec_command(command, timeout=timeout)
    output = stdout.read().decode('utf-8', 'replace'); error = stderr.read().decode('utf-8', 'replace')
    if stdout.channel.recv_exit_status() != 0: raise RuntimeError((error or output)[-8000:])
    return output


def digest(sftp, path):
    with sftp.file(path, 'rb') as handle: return hashlib.sha256(handle.read()).hexdigest()


def main():
    client=paramiko.SSHClient(); client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect('5.10.249.198',username='root',password=getpass.getpass('SSH password: '),timeout=20)
    backup=''; changed=False
    try:
        with client.open_sftp() as sftp:
            snapshot={path:digest(sftp,posixpath.join(DEST,path)) for path in FILES}
            lines=run(client,"set -eu; cd /root/socialCRM; stamp=$(date -u +%Y%m%dT%H%M%SZ); archive=backups/chart-contrast-before-$stamp.tar.gz; tar -czf \"$archive\" " + ' '.join(shlex.quote(path) for path in FILES) + "; test -s \"$archive\"; python3 scripts/backup-production.py; printf '\n%s' \"$archive\"").strip().splitlines()
            backup=lines[-1]
            for path,expected in snapshot.items():
                if digest(sftp,posixpath.join(DEST,path))!=expected: raise RuntimeError(f'Production changed during preflight: {path}')
            for relative in FILES:
                destination=posixpath.join(DEST,relative); temporary=destination+'.contrast-tmp'
                sftp.put(str(ROOT/relative),temporary); sftp.posix_rename(temporary,destination)
            changed=True
        run(client,'cd /root/socialCRM && docker compose build crm')
        run(client,'cd /root/socialCRM && docker compose up -d crm')
        run(client,"for n in $(seq 1 30); do curl -fsS http://127.0.0.1:3010/api/health >/dev/null && exit 0; sleep 3; done; exit 1",timeout=150)
        verification=run(client,"""python3 - <<'PY'
import http.cookiejar,json,re,urllib.request
from pathlib import Path
base='https://crm.haminyar.ir'; cfg={}
for line in Path('/root/socialCRM/.dev.vars').read_text().splitlines():
 if '=' in line and not line.lstrip().startswith('#'):
  k,v=line.split('=',1); cfg[k.strip()]=v.strip().strip(chr(34)+chr(39))
opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
login=urllib.request.Request(base+'/api/admin/auth/login',data=json.dumps({'email':cfg.get('ADMIN_EMAIL',''),'password':cfg['ADMIN_PASSWORD']}).encode(),headers={'Content-Type':'application/json','Origin':base},method='POST'); opener.open(login,timeout=60).read()
pages=[]
for path in ['/','/reports','/reports?section=matchmaking']:
 html=opener.open(base+path,timeout=60).read().decode('utf-8','replace'); assert len(html)>50000; pages.append(html)
assets=set(re.findall(r'href="([^"]+\.css[^"]*)"',''.join(pages)))
css=''.join(opener.open(base+asset,timeout=60).read().decode('utf-8','replace') for asset in assets)
assert '--chart-grid:' in css and '--chart-axis:' in css and '--chart-rose:' in css
print('PASS dashboard, reports and filtered report')
print('PASS theme-aware chart palette in production CSS')
PY""")
        print('LIGHT_CHART_CONTRAST_OK'); print(verification.strip()); print('Code backup:',backup)
    except Exception:
        if changed and backup: run(client,'cd /root/socialCRM && tar -xzf '+shlex.quote(backup)+' && docker compose up -d --build crm')
        raise
    finally: client.close()


if __name__=='__main__': main()
