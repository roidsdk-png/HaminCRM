#!/usr/bin/env python3
"""Show intended dashboard/report chart differences before deployment."""

import difflib, getpass, posixpath
from pathlib import Path
import paramiko

ROOT=Path(__file__).resolve().parents[1]
FILES=("components/dashboard-charts.tsx","app/reports/page.tsx")

def main():
    client=paramiko.SSHClient(); client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect('5.10.249.198',username='root',password=getpass.getpass('SSH password: '),timeout=20)
    try:
        with client.open_sftp() as sftp:
            for relative in FILES:
                with sftp.file(posixpath.join('/root/socialCRM',relative),'rb') as handle: remote=handle.read().decode().splitlines()
                local=(ROOT/relative).read_text(encoding='utf-8').splitlines()
                print('\n'.join(difflib.unified_diff(remote,local,fromfile='production/'+relative,tofile='local/'+relative,n=2)))
    finally: client.close()

if __name__=='__main__': main()
