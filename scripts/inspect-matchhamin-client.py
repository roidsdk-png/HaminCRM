#!/usr/bin/env python3
"""Read-only check before updating the matchmaking bot's CRM sender."""
from __future__ import annotations

import difflib
import argparse
import getpass
import hashlib
from pathlib import Path

import paramiko

LOCAL = Path(__file__).resolve().parents[2] / 'matchhamin-source' / 'crm_client.py'
REMOTE = '/opt/matchhamin-bot/crm_client.py'


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--host', choices=('5.10.249.198', '5.10.249.72'), default='5.10.249.198')
    options = parser.parse_args()
    client = paramiko.SSHClient()
    client.load_system_host_keys()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(options.host, username='root', password=getpass.getpass('SSH password: '), timeout=20)
    try:
        with client.open_sftp() as sftp:
            try:
                with sftp.open(REMOTE, 'rb') as handle:
                    remote = handle.read().decode('utf-8')
            except FileNotFoundError:
                _, stdout, _ = client.exec_command("find /opt /root -maxdepth 5 -name crm_client.py -type f -print 2>/dev/null | head -20")
                paths = stdout.read().decode('utf-8', 'replace').splitlines()
                print('Candidate client paths:', paths)
                return
        local = LOCAL.read_text(encoding='utf-8')
        print('production', hashlib.sha256(remote.encode()).hexdigest())
        print('local', hashlib.sha256(local.encode()).hexdigest())
        diff = list(difflib.unified_diff(remote.splitlines(), local.splitlines(), fromfile=REMOTE, tofile=str(LOCAL), n=2))
        print('Diff lines:', len(diff))
        print('\n'.join(diff[:65]))
    finally:
        client.close()


if __name__ == '__main__':
    main()
