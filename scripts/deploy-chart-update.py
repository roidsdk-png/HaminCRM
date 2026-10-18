#!/usr/bin/env python3
"""Deploy the verified dashboard tooltip and filtered report chart update."""

import getpass, hashlib, posixpath, shlex
from pathlib import Path
import paramiko

ROOT=Path(__file__).resolve().parents[1]
DEST='/root/socialCRM'
FILES=('components/dashboard-charts.tsx','app/reports/page.tsx')

def run(client,command,timeout=1800):
    _,stdout,stderr=client.exec_command(command,timeout=timeout)
    output=stdout.read().decode('utf-8','replace'); error=stderr.read().decode('utf-8','replace')
    if stdout.channel.recv_exit_status()!=0: raise RuntimeError((error or output)[-6000:])
    return output

def digest(sftp,path):
    with sftp.file(path,'rb') as handle: return hashlib.sha256(handle.read()).hexdigest()

def main():
    client=paramiko.SSHClient(); client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect('5.10.249.198',username='root',password=getpass.getpass('SSH password: '),timeout=20)
    backup=''; changed=False
    try:
        with client.open_sftp() as sftp:
            snapshot={path:digest(sftp,posixpath.join(DEST,path)) for path in FILES}
            lines=run(client,"set -eu; cd /root/socialCRM; stamp=$(date -u +%Y%m%dT%H%M%SZ); archive=backups/charts-before-$stamp.tar.gz; tar -czf \"$archive\" " + ' '.join(shlex.quote(x) for x in FILES) + "; test -s \"$archive\"; python3 scripts/backup-production.py; printf '\\n%s' \"$archive\"").strip().splitlines()
            backup=lines[-1]
            if not backup.startswith('backups/charts-before-'): raise RuntimeError('Unexpected backup path')
            for path,expected in snapshot.items():
                if digest(sftp,posixpath.join(DEST,path))!=expected: raise RuntimeError(f'Production changed during preflight: {path}')
            for relative in FILES:
                destination=posixpath.join(DEST,relative); temporary=destination+'.chart-tmp'
                sftp.put(str(ROOT/relative),temporary); sftp.posix_rename(temporary,destination)
            changed=True
        run(client,'cd /root/socialCRM && docker compose build crm')
        run(client,'cd /root/socialCRM && docker compose up -d crm')
        run(client,"for n in $(seq 1 30); do curl -fsS http://127.0.0.1:3010/api/health >/dev/null && exit 0; sleep 3; done; exit 1",timeout=150)
        verification=run(client,"python3 - <<'PY'\nimport http.cookiejar,json,urllib.request\nfrom pathlib import Path\nbase='https://crm.haminyar.ir'; cfg={}\nfor line in Path('/root/socialCRM/.dev.vars').read_text().splitlines():\n if '=' in line and not line.lstrip().startswith('#'):\n  k,v=line.split('=',1); cfg[k.strip()]=v.strip().strip(chr(34)+chr(39))\nopener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))\nreq=urllib.request.Request(base+'/api/admin/auth/login',data=json.dumps({'email':cfg.get('ADMIN_EMAIL',''),'password':cfg['ADMIN_PASSWORD']}).encode(),headers={'Content-Type':'application/json','Origin':base},method='POST'); opener.open(req,timeout=60).read()\nfor path in ['/','/reports','/reports?section=test&source=honaz-test&gender=male&from=2026-09-01&to=2026-09-22']:\n page=opener.open(base+path,timeout=60).read().decode('utf-8','replace')\n assert 'مقایسه حجم فعالیت‌ها' in page if path.startswith('/reports') else True\n print('PASS',path,len(page))\nPY")
        print('CHART_UPDATE_OK'); print(verification.strip()); print('Code backup:',backup)
    except Exception:
        if changed and backup:
            run(client,'cd /root/socialCRM && tar -xzf '+shlex.quote(backup)+' && docker compose up -d --build crm')
        raise
    finally: client.close()

if __name__=='__main__': main()
