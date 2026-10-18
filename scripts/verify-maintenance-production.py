#!/usr/bin/env python3
"""End-to-end checks for errors, backup lifecycle, cache UI, and disabled source creation."""

import getpass
import paramiko


REMOTE = r'''
import gzip, http.cookiejar, io, json, sqlite3, urllib.error, urllib.request
from pathlib import Path

BASE='https://crm.haminyar.ir'
cfg={}
for line in Path('/root/socialCRM/.dev.vars').read_text().splitlines():
    if '=' in line and not line.lstrip().startswith('#'):
        k,v=line.split('=',1); cfg[k.strip()]=v.strip().strip('"\'')

def check(value,label):
    if not value: raise AssertionError(label)
    print('PASS',label)
def call(client,method,path,data=None):
    headers={'Origin':BASE,'Accept':'application/json'}
    if data is not None: headers['Content-Type']='application/json'
    request=urllib.request.Request(BASE+path,data=data,headers=headers,method=method)
    try:
        with client.open(request,timeout=90) as response: return response.status,response.read(),dict(response.headers)
    except urllib.error.HTTPError as error: return error.code,error.read(),dict(error.headers)

owner=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
status,_,_=call(owner,'POST','/api/admin/auth/login',json.dumps({'email':cfg.get('ADMIN_EMAIL',''),'password':cfg['ADMIN_PASSWORD']}).encode())
check(status==200,'owner login')
status,system,_=call(owner,'GET','/system'); text=system.decode('utf-8','replace')
check(status==200 and 'پاک‌کردن خطا' in text,'error dismissal control visible')
check('Cache Storage' in text and 'سرویس‌ورکر' in text,'cache scope is accurately displayed')
status,sources,_=call(owner,'GET','/sources'); source_text=sources.decode('utf-8','replace')
check(status==200 and 'افزودن منبع جدید' not in source_text,'manual source button removed')
status,_,headers=call(owner,'POST','/api/admin/sources',b'{}')
check(status==405 and headers.get('Allow')=='GET','manual source API disabled')

# Create, download, validate, delete, and confirm removal of one disposable backup.
status,created,_=call(owner,'POST','/api/admin/backups',b'{}'); check(status==201,'backup creation')
name=json.loads(created)['backup']['name']
status,archive,_=call(owner,'GET','/api/admin/backups/'+name); check(status==200 and archive[:2]==b'\x1f\x8b','backup download')
raw=gzip.decompress(archive)
tmp=Path('/tmp/crm-maintenance-backup.sqlite'); tmp.write_bytes(raw)
d=sqlite3.connect(tmp); check(d.execute('PRAGMA integrity_check').fetchone()[0]=='ok','downloaded backup integrity'); check(d.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table'").fetchone()[0]>=10,'backup contains CRM tables'); d.close(); tmp.unlink()
status,_,_=call(owner,'DELETE','/api/admin/backups/'+name); check(status==200,'backup deletion')
status,listing,_=call(owner,'GET','/api/admin/backups'); check(name not in [x['name'] for x in json.loads(listing)['backups']],'deleted backup absent from list')

# Verify deletion with one explicitly synthetic error; never remove real historical errors in this check.
dbs=[x for x in Path('/root/socialCRM/data/v3/d1').rglob('*.sqlite') if 'metadata' not in x.parts and x.name!='metadata.sqlite']; check(len(dbs)==1,'single CRM database')
d=sqlite3.connect(dbs[0]); source=d.execute('SELECT id FROM sources LIMIT 1').fetchone()[0]; synthetic='maintenance-delete-check'; now=int(__import__('time').time());
d.execute("INSERT OR REPLACE INTO ingestion_events(id,source_id,external_event_id,type,payload,occurred_at,received_at,processing_status,processing_error) VALUES(?,?,?,?,?,?,?,?,?)",(synthetic,source,synthetic,'system.maintenance.check','{}',now,now,'failed','synthetic check')); d.commit(); d.close()
status,_,_=call(owner,'DELETE','/api/admin/ingestion-errors/'+synthetic); check(status==200,'single failed event dismissal')
d=sqlite3.connect(dbs[0]); remains=d.execute('SELECT COUNT(*) FROM ingestion_events WHERE id=?',(synthetic,)).fetchone()[0]; audit=d.execute("SELECT COUNT(*) FROM audit_logs WHERE action='ingestion.error.dismissed' AND entity_id=?",(synthetic,)).fetchone()[0]; d.close()
check(remains==0,'synthetic error removed'); check(audit==1,'dismissal audited')
print('MAINTENANCE_VERIFY_OK')
'''


def main():
    client=paramiko.SSHClient(); client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect('5.10.249.198',username='root',password=getpass.getpass('SSH password: '),timeout=20)
    try:
        stdin,stdout,stderr=client.exec_command('python3 -',timeout=300)
        stdin.write(REMOTE); stdin.channel.shutdown_write()
        output=stdout.read().decode('utf-8','replace'); error=stderr.read().decode('utf-8','replace')
        if stdout.channel.recv_exit_status()!=0: raise RuntimeError(error or output)
        print(output,end='')
    finally: client.close()


if __name__=='__main__': main()
