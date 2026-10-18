#!/usr/bin/env python3
"""Deploy only the verified CRM brand and source-health UI files to the self-hosted server."""
from __future__ import annotations

import getpass
import hashlib
import posixpath
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parents[1]
DEST = '/root/socialCRM'
EXPECTED = {
    'app/layout.tsx': '7f1a88927869',
    'app/login/page.tsx': 'bb5a02ac08bf',
    'app/[section]/page.tsx': '28b298bb526e',
    'app/[section]/[id]/page.tsx': '290ba6f82eef',
    'app/page.tsx': '0ed529aaa7b5',
    'app/reports/page.tsx': '592686b8da96',
    'app/sources/page.tsx': 'b8cc40f8b1cd',
    'components/crm-shell.tsx': 'd2dbb80697be',
    'components/source-manager.tsx': '2e0633564153',
}


def run(client: paramiko.SSHClient, command: str, timeout: int = 1200) -> str:
    _, stdout, stderr = client.exec_command(command, timeout=timeout)
    output = stdout.read().decode('utf-8', 'replace')
    error = stderr.read().decode('utf-8', 'replace')
    if stdout.channel.recv_exit_status() != 0:
        raise RuntimeError(error or output)
    return output


def main() -> None:
    client = paramiko.SSHClient()
    client.load_system_host_keys()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect('5.10.249.198', username='root', password=getpass.getpass('SSH password: '), timeout=20)
    archive = ''
    changed = False
    try:
        with client.open_sftp() as sftp:
            for relative, expected in EXPECTED.items():
                with sftp.open(posixpath.join(DEST, relative), 'rb') as handle:
                    actual = hashlib.sha256(handle.read()).hexdigest()
                if not actual.startswith(expected):
                    raise RuntimeError(f'Production file changed since preflight: {relative}')

            archive = run(client, "set -eu; cd /root/socialCRM; mkdir -p backups; "
                          "stamp=$(date -u +%Y%m%dT%H%M%SZ); "
                          "archive=backups/brand-before-$stamp.tar.gz; "
                          "tar -czf \"$archive\" " + ' '.join("'" + f + "'" for f in EXPECTED) + "; "
                          "test -s \"$archive\"; printf '%s' \"$archive\"").strip()
            if not archive.startswith('backups/brand-before-') or not archive.endswith('.tar.gz'):
                raise RuntimeError('Unexpected backup archive name')

            for relative in EXPECTED:
                destination = posixpath.join(DEST, relative)
                temporary = destination + '.hamin-update-tmp'
                sftp.put(str(ROOT / relative), temporary)
                sftp.posix_rename(temporary, destination)
                changed = True

        print(run(client, 'cd /root/socialCRM && docker compose up -d --build', timeout=1800))
        print(run(client, "for attempt in 1 2 3 4 5 6 7 8 9 10; do "
                          "curl -fsS http://127.0.0.1:3010/api/health && exit 0; sleep 3; done; exit 1", timeout=90))
        print('CRM update healthy; code backup:', archive)
    except Exception:
        if changed and archive:
            print('Deployment failed; restoring the saved code.')
            run(client, "cd /root/socialCRM && tar -xzf '" + archive + "' && docker compose up -d --build", timeout=1800)
        raise
    finally:
        client.close()


if __name__ == '__main__':
    main()
