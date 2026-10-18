#!/usr/bin/env python3
"""Check owner access and real CRM backup files without deleting production backups."""
from __future__ import annotations

import getpass
import paramiko

REMOTE = r'''
import http.cookiejar
import json
import urllib.error
import urllib.request
from pathlib import Path

BASE = 'https://crm.haminyar.ir'
config = {}
for raw in Path('/root/socialCRM/.dev.vars').read_text().splitlines():
    if '=' in raw and not raw.lstrip().startswith('#'):
        key, value = raw.split('=', 1)
        config[key.strip()] = value.strip().strip('"\'')

def check(condition, label):
    if not condition: raise AssertionError(label)
    print('PASS', label)

def request(client, method, path, data=None):
    headers = {'Origin':BASE, 'Accept':'application/json'}
    if data is not None: headers['Content-Type']='application/json'
    req = urllib.request.Request(BASE+path, data=data, headers=headers, method=method)
    try:
        with client.open(req, timeout=60) as response:
            return response.status, response.read(), dict(response.headers)
    except urllib.error.HTTPError as error:
        return error.code, error.read(), dict(error.headers)

owner = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
guest = urllib.request.build_opener()
check(request(guest,'GET','/api/admin/backups')[0] == 403, 'guest backup list forbidden')
status, body, _ = request(owner,'POST','/api/admin/auth/login',json.dumps({'email':config.get('ADMIN_EMAIL',''), 'password':config['ADMIN_PASSWORD']}).encode())
check(status == 200, 'owner login')
status, page, _ = request(owner,'GET','/system')
check(status == 200 and 'بکاپ‌های کامل دیتابیس CRM' in page.decode(), 'system backup panel visible')
status, payload, _ = request(owner,'GET','/api/admin/backups')
print('LIST_STATUS',status,'BODY',payload[:500].decode('utf-8','replace'))
check(status == 200, 'CRM backup list works')
backups = json.loads(payload)['backups']
check(len(backups) >= 1, 'server backups listed')
first = backups[0]
status, file_body, headers = request(owner,'GET','/api/admin/backups/'+first['name'])
check(status == 200 and file_body.startswith(bytes([31,139])) and len(file_body)==first['bytes'], 'full CRM backup download matches listed file')
check('application/gzip' in headers.get('Content-Type',''), 'backup download type')
status, _, _ = request(guest,'GET','/api/admin/backups/'+first['name'])
check(status == 403, 'guest backup download forbidden')
status, _, _ = request(guest,'DELETE','/api/admin/backups/'+first['name'])
check(status == 403, 'guest backup deletion forbidden')
status, created_body, _ = request(owner,'POST','/api/admin/backups',b'{}')
check(status == 201, 'owner can create a complete CRM snapshot')
created_name = json.loads(created_body)['backup']['name']
status, refreshed, _ = request(owner,'GET','/api/admin/backups')
check(status == 200 and created_name in [item['name'] for item in json.loads(refreshed)['backups']], 'new snapshot appears in CRM list')
print('BACKUP_COUNT',len(backups),'NEWEST',first['name'])
'''

def main() -> None:
    password = getpass.getpass('SSH password: ')
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect('5.10.249.198', username='root', password=password, timeout=20)
    try:
        stdin, stdout, stderr = client.exec_command('python3 -', timeout=180)
        stdin.write(REMOTE)
        stdin.channel.shutdown_write()
        output = stdout.read().decode('utf-8','replace')
        error = stderr.read().decode('utf-8','replace')
        status = stdout.channel.recv_exit_status()
        print(output, end='')
        if status != 0: raise RuntimeError(error or f'Production check failed: {status}')
    finally:
        client.close()

if __name__ == '__main__':
    main()
