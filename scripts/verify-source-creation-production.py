#!/usr/bin/env python3
"""Verify creation/authentication with one temporary source and clean it up."""
from __future__ import annotations

import getpass
import paramiko

REMOTE = r'''
import http.cookiejar
import json
import sqlite3
import time
import datetime
import urllib.error
import urllib.request
from pathlib import Path

BASE='https://crm.haminyar.ir'
DATABASE='/root/socialCRM/data/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite'
config={}
for raw in Path('/root/socialCRM/.dev.vars').read_text().splitlines():
    if '=' in raw and not raw.lstrip().startswith('#'):
        key,value=raw.split('=',1);config[key.strip()]=value.strip().strip('"\'')
slug='crm-connection-check-'+str(int(time.time()))
source_id=None
owner=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

def request(method,path,body=None,headers=None):
    prepared=None if body is None else json.dumps(body).encode()
    values={'Origin':BASE,'Content-Type':'application/json'}
    values.update(headers or {})
    req=urllib.request.Request(BASE+path,data=prepared,headers=values,method=method)
    try:
        with owner.open(req,timeout=30) as response:return response.status,response.read()
    except urllib.error.HTTPError as error:return error.code,error.read()

try:
    status,_=request('POST','/api/admin/auth/login',{'email':config.get('ADMIN_EMAIL',''),'password':config['ADMIN_PASSWORD']})
    assert status==200,status
    status,data=request('POST','/api/admin/sources',{'name':'CRM temporary connection check','slug':slug,'kind':'chatbot','platform':'bale'})
    assert status==200,(status,data[:300])
    result=json.loads(data);source_id=result['source']['id'];secret=result['secret']
    assert len(secret)>=32
    print('PASS temporary source creation and one-time key')
    status,_=request('POST','/api/admin/sources',{'name':'Duplicate','slug':slug,'kind':'chatbot','platform':'bale'})
    assert status==409,status
    print('PASS duplicate source slug rejected')
    status,_=request('POST','/api/v1/events',{},headers={'X-CRM-Source':slug,'X-CRM-Key':'invalid'})
    assert status==401,status
    status,_=request('POST','/api/v1/events',{},headers={'X-CRM-Source':slug,'X-CRM-Key':secret})
    assert status==400,status
    print('PASS source key authentication and envelope validation')
    headers={'X-CRM-Source':slug,'X-CRM-Key':secret}
    now=datetime.datetime.now(datetime.timezone.utc).isoformat()
    event=lambda event_id,kind,payload:{'eventId':slug+'-'+event_id,'type':kind,'occurredAt':now,'payload':payload}
    identity={'anonymousId':slug+'-person'}
    message=event('message','message.created',{'sessionId':slug+'-session',**identity,'role':'user','content':'temporary CRM ingestion check'})
    status,_=request('POST','/api/v1/events',message,headers=headers);assert status==202,status
    status,_=request('POST','/api/v1/events',message,headers=headers);assert status==202,status
    analysis=event('analysis','test.analysis.updated',{'attemptId':slug+'-attempt','aiAnalysis':'temporary check'})
    status,_=request('POST','/api/v1/events',analysis,headers=headers);assert status==503,status
    test=event('test','test.completed',{'attemptId':slug+'-attempt','testKey':'temporary-check','profile':identity,'answers':[{'questionText':'temporary question','value':'yes'}]})
    status,_=request('POST','/api/v1/events',test,headers=headers);assert status==202,status
    status,_=request('POST','/api/v1/events',analysis,headers=headers);assert status==202,status
    match=event('match','matchmaking.profile.completed',{'profileId':slug+'-profile','profile':identity,'answers':[{'questionText':'temporary match question','value':'yes'}]})
    status,_=request('POST','/api/v1/events',match,headers=headers);assert status==202,status
    db=sqlite3.connect(DATABASE,timeout=30)
    try:
        assert db.execute('SELECT COUNT(*) FROM messages WHERE source_id=?',(source_id,)).fetchone()[0]==1
        assert db.execute('SELECT COUNT(*) FROM test_attempts WHERE source_id=? AND ai_analysis=?',(source_id,'temporary check')).fetchone()[0]==1
        assert db.execute('SELECT COUNT(*) FROM test_answers x JOIN test_attempts a ON a.id=x.attempt_id WHERE a.source_id=?',(source_id,)).fetchone()[0]==1
        assert db.execute('SELECT COUNT(*) FROM match_profiles WHERE source_id=?',(source_id,)).fetchone()[0]==1
        assert db.execute('SELECT COUNT(*) FROM ingestion_events WHERE source_id=? AND processing_status=?',(source_id,'failed')).fetchone()[0]==0
    finally:db.close()
    print('PASS live event ingest, duplicate protection, failed-event retry, tests, matches')
finally:
    if source_id:
        db=sqlite3.connect(DATABASE,timeout=30)
        try:
            db.execute('DELETE FROM test_answers WHERE attempt_id IN (SELECT id FROM test_attempts WHERE source_id=?)',(source_id,))
            db.execute('DELETE FROM match_answers WHERE profile_id IN (SELECT id FROM match_profiles WHERE source_id=?)',(source_id,))
            for table in ('messages','conversations','test_attempts','match_profiles','ingestion_events','contacts'):
                db.execute(f'DELETE FROM {table} WHERE source_id=?',(source_id,))
            db.execute('DELETE FROM sources WHERE id=? AND slug=?',(source_id,slug))
            db.commit()
            assert db.execute('SELECT COUNT(*) FROM sources WHERE id=?',(source_id,)).fetchone()[0]==0
            print('PASS temporary source removed; real sources untouched')
        finally:db.close()
'''

def main() -> None:
    password=getpass.getpass('SSH password: ')
    client=paramiko.SSHClient();client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect('5.10.249.198',username='root',password=password,timeout=20)
    try:
        stdin,stdout,stderr=client.exec_command('python3 -',timeout=120)
        stdin.write(REMOTE);stdin.channel.shutdown_write()
        output=stdout.read().decode('utf-8','replace');error=stderr.read().decode('utf-8','replace')
        status=stdout.channel.recv_exit_status();print(output,end='')
        if status!=0:raise RuntimeError(error or f'Source test failed: {status}')
    finally:client.close()

if __name__=='__main__':main()
