#!/usr/bin/env python3
"""Deploy only verified report-filter files to the self-hosted CRM with rollback."""
from __future__ import annotations

import getpass
import hashlib
import posixpath
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parents[1]
DEST = '/root/socialCRM'
EXPECTED = {
    'lib/reports.ts': '124f87d01783c60555e5adec8e70d374b183b217dc7c86c7ba95e7a284c0aa88',
    'app/reports/page.tsx': '9784c904f508d882951f9a0854323c25701ba6e436746678aaac3b5e867c65f6',
    'components/dashboard-charts.tsx': 'f0ea3867acd9e7b1b9d19df8c063633c45a61ad6e7aff6b2c7e654b5a60b85b9',
    'app/api/admin/export/route.ts': 'a6362a7b800413f9b7d91f5292e2ec5b8c76e027b52f719f66228879cf55172c',
}


def run(client: paramiko.SSHClient, command: str, timeout: int = 1800) -> str:
    _, stdout, stderr = client.exec_command(command, timeout=timeout)
    output = stdout.read().decode('utf-8', 'replace')
    error = stderr.read().decode('utf-8', 'replace')
    if stdout.channel.recv_exit_status() != 0:
        raise RuntimeError((error or output)[-2500:])
    return output


def main() -> None:
    client = paramiko.SSHClient()
    client.load_system_host_keys()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect('5.10.249.198', username='root', password=getpass.getpass('SSH password: '), timeout=20)
    backup = ''
    changed = False
    try:
        with client.open_sftp() as sftp:
            for relative, expected in EXPECTED.items():
                with sftp.open(posixpath.join(DEST, relative), 'rb') as handle:
                    actual = hashlib.sha256(handle.read()).hexdigest()
                if actual != expected:
                    raise RuntimeError(f'Production file changed since preflight: {relative}')

            backup = run(client, "set -eu; cd /root/socialCRM; mkdir -p backups; "
                         "stamp=$(date -u +%Y%m%dT%H%M%SZ); archive=backups/reports-before-$stamp.tar.gz; "
                         "tar -czf \"$archive\" " + ' '.join("'" + path + "'" for path in EXPECTED) + "; "
                         "test -s \"$archive\"; printf '%s' \"$archive\"").strip()
            if not backup.startswith('backups/reports-before-') or not backup.endswith('.tar.gz'):
                raise RuntimeError('Unexpected backup name')

            for relative in EXPECTED:
                destination = posixpath.join(DEST, relative)
                staged = destination + '.hamin-report-tmp'
                sftp.put(str(ROOT / relative), staged)
                sftp.posix_rename(staged, destination)
                changed = True

        run(client, 'cd /root/socialCRM && docker compose up -d --build')
        health = run(client, "for attempt in 1 2 3 4 5 6 7 8 9 10; do "
                           "curl -fsS http://127.0.0.1:3010/api/health && exit 0; sleep 3; done; exit 1", timeout=90)
        print('CRM report update healthy:', health.strip(), 'backup:', backup)
    except Exception:
        if changed and backup:
            print('Deployment failed; restoring report files.')
            run(client, "cd /root/socialCRM && tar -xzf '" + backup + "' && docker compose up -d --build")
        raise
    finally:
        client.close()


if __name__ == '__main__':
    main()
