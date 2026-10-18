#!/usr/bin/env python3
"""Read-only comparison of the requested CRM files against the self-hosted checkout."""
from __future__ import annotations

import difflib
import getpass
import hashlib
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parents[1]
FILES = (
    'app/layout.tsx', 'app/login/page.tsx', 'app/[section]/page.tsx',
    'app/[section]/[id]/page.tsx', 'app/page.tsx', 'app/reports/page.tsx',
    'app/sources/page.tsx', 'components/crm-shell.tsx',
    'components/source-manager.tsx',
)


def main() -> None:
    client = paramiko.SSHClient()
    client.load_system_host_keys()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect('5.10.249.198', username='root', password=getpass.getpass('SSH password: '), timeout=20)
    try:
        with client.open_sftp() as sftp:
            for relative in FILES:
                local = (ROOT / relative).read_text(encoding='utf-8')
                with sftp.open('/root/socialCRM/' + relative, 'r') as remote_file:
                    remote = remote_file.read().decode('utf-8')
                changed = list(difflib.unified_diff(remote.splitlines(), local.splitlines(), fromfile='production/' + relative, tofile='local/' + relative, n=1))
                print(relative, 'same' if not changed else f'different ({len(changed)} diff lines)',
                      hashlib.sha256(remote.encode()).hexdigest()[:12], hashlib.sha256(local.encode()).hexdigest()[:12])
                for line in changed[:45]:
                    print(line)
                if len(changed) > 45:
                    print('... diff truncated')
    finally:
        client.close()


if __name__ == '__main__':
    main()
