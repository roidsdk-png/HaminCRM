#!/usr/bin/env python3
"""Read-only preflight for the four report-filter files on the CRM server."""
from __future__ import annotations

import difflib
import getpass
import hashlib
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parents[1]
FILES = (
    'lib/reports.ts',
    'app/reports/page.tsx',
    'components/dashboard-charts.tsx',
    'app/api/admin/export/route.ts',
)


def main() -> None:
    client = paramiko.SSHClient()
    client.load_system_host_keys()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect('5.10.249.198', username='root', password=getpass.getpass('SSH password: '), timeout=20)
    try:
        with client.open_sftp() as sftp:
            for relative in FILES:
                with sftp.open('/root/socialCRM/' + relative, 'rb') as handle:
                    remote = handle.read().decode('utf-8')
                local = (ROOT / relative).read_text(encoding='utf-8')
                diff = list(difflib.unified_diff(remote.splitlines(), local.splitlines(), n=1))
                print(relative, 'remote_sha256=' + hashlib.sha256(remote.encode()).hexdigest(), 'diff_lines=' + str(len(diff)))
                print('\n'.join(diff[:25]))
    finally:
        client.close()


if __name__ == '__main__':
    main()
