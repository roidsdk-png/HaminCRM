#!/usr/bin/env python3
"""Deploy and verify revocable owner magic-link access."""

import getpass
import hashlib
import json
import posixpath
import shlex
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parents[1]
DEST = '/root/socialCRM'
FILES = (
    'lib/magic-access.ts',
    'app/api/admin/magic-access/route.ts',
    'app/magic/[token]/route.ts',
    'components/magic-access-settings.tsx',
    'app/access/page.tsx',
)


def run(client, command, timeout=1800):
    _, stdout, stderr = client.exec_command(command, timeout=timeout)
    output = stdout.read().decode('utf-8', 'replace')
    error = stderr.read().decode('utf-8', 'replace')
    if stdout.channel.recv_exit_status() != 0:
        raise RuntimeError((error or output)[-8000:])
    return output


def digest(sftp, path):
    try:
        with sftp.file(path, 'rb') as handle:
            return hashlib.sha256(handle.read()).hexdigest()
    except FileNotFoundError:
        return None


def mkdirs(sftp, path):
    current = ''
    for part in path.strip('/').split('/'):
        current += '/' + part
        try:
            sftp.stat(current)
        except FileNotFoundError:
            sftp.mkdir(current)


def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect('5.10.249.198', username='root', password=getpass.getpass('SSH password: '), timeout=20)
    backup = ''
    changed = False
    try:
        with client.open_sftp() as sftp:
            snapshot = {path: digest(sftp, posixpath.join(DEST, path)) for path in FILES}
            existing = [path for path, value in snapshot.items() if value]
            command = "set -eu; cd /root/socialCRM; stamp=$(date -u +%Y%m%dT%H%M%SZ); archive=backups/magic-access-before-$stamp.tar.gz; "
            if existing:
                command += "tar -czf \"$archive\" " + ' '.join(shlex.quote(path) for path in existing) + "; "
            else:
                command += "tar -czf \"$archive\" --files-from /dev/null; "
            command += "test -s \"$archive\"; python3 scripts/backup-production.py; printf '\\n%s' \"$archive\""
            backup = run(client, command).strip().splitlines()[-1]
            for path, expected in snapshot.items():
                if digest(sftp, posixpath.join(DEST, path)) != expected:
                    raise RuntimeError(f'Production changed during preflight: {path}')
            for relative in FILES:
                destination = posixpath.join(DEST, relative)
                mkdirs(sftp, posixpath.dirname(destination))
                temporary = destination + '.magic-tmp'
                sftp.put(str(ROOT / relative), temporary)
                sftp.posix_rename(temporary, destination)
            changed = True

        run(client, 'cd /root/socialCRM && docker compose build crm')
        run(client, 'cd /root/socialCRM && docker compose up -d crm')
        run(client, "for n in $(seq 1 30); do curl -fsS http://127.0.0.1:3010/api/health >/dev/null && exit 0; sleep 3; done; exit 1", timeout=150)
        verification = run(client, """python3 - <<'PY'
import http.cookiejar,json,urllib.error,urllib.request
from pathlib import Path
base='https://crm.haminyar.ir'; cfg={}
for line in Path('/root/socialCRM/.dev.vars').read_text().splitlines():
 if '=' in line and not line.lstrip().startswith('#'):
  k,v=line.split('=',1); cfg[k.strip()]=v.strip().strip(chr(34)+chr(39))
owner=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
login=urllib.request.Request(base+'/api/admin/auth/login',data=json.dumps({'email':cfg.get('ADMIN_EMAIL',''),'password':cfg['ADMIN_PASSWORD']}).encode(),headers={'Content-Type':'application/json','Origin':base},method='POST')
owner.open(login,timeout=60).read()
create=urllib.request.Request(base+'/api/admin/magic-access',data=b'',headers={'Origin':base},method='POST')
result=json.loads(owner.open(create,timeout=60).read())
link=result['link']
magic=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
page=magic.open(link,timeout=60).read().decode('utf-8','replace')
assert 'داشبورد' in page or 'حامین چارت' in page
access=magic.open(base+'/access',timeout=60).read().decode('utf-8','replace')
assert 'لینک ورود اختصاصی بدون رمز' in access
invalid=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
invalid_page=invalid.open(base+'/magic/not-a-valid-token',timeout=60).geturl()
assert '/login' in invalid_page
print('PASS magic login and owner access')
print('PASS invalid token rejected')
print('MAGIC_LINK='+link)
PY""")
        print('MAGIC_ACCESS_OK')
        print(verification.strip())
        print('Code backup:', backup)
    except Exception:
        if changed and backup:
            run(client, 'cd /root/socialCRM && tar -xzf ' + shlex.quote(backup) + ' && docker compose up -d --build crm')
        raise
    finally:
        client.close()


if __name__ == '__main__':
    main()
