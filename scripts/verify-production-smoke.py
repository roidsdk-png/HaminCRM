#!/usr/bin/env python3
"""Run the existing read-only production surface/API smoke test over SSH."""

import getpass
import paramiko

REMOTE = r'''
import os,subprocess
from pathlib import Path
cfg={}
for line in Path('/root/socialCRM/.dev.vars').read_text().splitlines():
 if '=' in line and not line.lstrip().startswith('#'):
  k,v=line.split('=',1); cfg[k.strip()]=v.strip().strip(chr(34)+chr(39))
env=os.environ.copy(); env['CRM_TEST_URL']='https://crm.haminyar.ir'; env['CRM_TEST_PASSWORD']=cfg['ADMIN_PASSWORD']
result=subprocess.run(['npm','run','test:smoke'],cwd='/root/socialCRM',env=env,text=True,capture_output=True,timeout=180)
print(result.stdout,end='')
if result.returncode:
 print(result.stderr,end='')
 raise SystemExit(result.returncode)
'''


def main():
    client=paramiko.SSHClient(); client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect('5.10.249.198',username='root',password=getpass.getpass('SSH password: '),timeout=20)
    try:
        stdin,stdout,stderr=client.exec_command('python3 -',timeout=240)
        stdin.write(REMOTE); stdin.channel.shutdown_write()
        output=stdout.read().decode('utf-8','replace'); error=stderr.read().decode('utf-8','replace')
        status=stdout.channel.recv_exit_status(); print(output,end='')
        if status: raise RuntimeError(error or f'smoke test failed: {status}')
    finally: client.close()


if __name__=='__main__': main()
