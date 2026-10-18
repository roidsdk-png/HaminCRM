#!/usr/bin/env python3
"""Deploy only CRM ingestion and live-refresh code, preserving a recoverable backup."""
from __future__ import annotations

import getpass
from pathlib import Path
import paramiko

ROOT = Path(__file__).resolve().parents[1]
FILES = ('lib/ingestion.ts', 'app/api/v1/events/route.ts', 'components/crm-shell.tsx')
DEST = '/root/socialCRM'


def run(client: paramiko.SSHClient, command: str, timeout: int = 1200) -> str:
    _, stdout, stderr = client.exec_command(command, timeout=timeout)
    output = stdout.read().decode('utf-8', 'replace')
    error = stderr.read().decode('utf-8', 'replace')
    if stdout.channel.recv_exit_status() != 0:
        raise RuntimeError(error or output)
    return output


def main() -> None:
    password = getpass.getpass('SSH password: ')
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect('5.10.249.198', username='root', password=password, timeout=20)
    try:
        run(client, 'set -eu; test -d /root/socialCRM; test -f /root/socialCRM/lib/ingestion.ts; '
            'test -f /root/socialCRM/app/api/v1/events/route.ts; test -f /root/socialCRM/components/crm-shell.tsx; '
            'mkdir -p /root/socialCRM/backups; stamp=$(date -u +%Y%m%dT%H%M%SZ); '
            'tar -czf "/root/socialCRM/backups/ingestion-code-before-$stamp.tar.gz" -C /root/socialCRM '
            'lib/ingestion.ts app/api/v1/events/route.ts components/crm-shell.tsx; '
            'python3 /root/socialCRM/scripts/backup-production.py')
        with client.open_sftp() as sftp:
            for relative in FILES:
                sftp.put(str(ROOT / relative), f'{DEST}/{relative}')
        print(run(client, 'cd /root/socialCRM && docker compose up -d --build', timeout=1800))
        print(run(client, 'curl -fsS http://127.0.0.1:3010/api/health'))
    finally:
        client.close()


if __name__ == '__main__':
    main()
