#!/usr/bin/env python3
"""Replace only the verified live CRM sender; preserve an exact rollback copy."""
from __future__ import annotations

import getpass
import hashlib
from datetime import datetime, timezone
from pathlib import Path

import paramiko

LOCAL = Path(__file__).resolve().parents[2] / 'matchhamin-source' / 'crm_client.py'
REMOTE = '/opt/matchhamin-bot/crm_client.py'
EXPECTED_SHA256 = 'a75b563bcd86d6fe642a948f892b726e6fe6f8e7ea598ba34c6dd62a29229b57'
SERVICE = 'matchhamin-bot.service'


def run(client: paramiko.SSHClient, command: str) -> None:
    _, stdout, stderr = client.exec_command(command, timeout=60)
    output = stdout.read().decode('utf-8', 'replace')
    error = stderr.read().decode('utf-8', 'replace')
    if stdout.channel.recv_exit_status() != 0:
        raise RuntimeError((error or output)[:1000])


def main() -> None:
    client = paramiko.SSHClient()
    client.load_system_host_keys()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect('5.10.249.72', username='root', password=getpass.getpass('SSH password: '), timeout=20)
    backup = REMOTE + '.bak.' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    updated = False
    try:
        run(client, f'systemctl is-active --quiet {SERVICE}')
        with client.open_sftp() as sftp:
            with sftp.open(REMOTE, 'rb') as handle:
                original = handle.read()
            if hashlib.sha256(original).hexdigest() != EXPECTED_SHA256:
                raise RuntimeError('Live client changed since preflight; no files were modified')
            with sftp.open(backup, 'wb') as handle:
                handle.write(original)
            sftp.chmod(backup, sftp.stat(REMOTE).st_mode & 0o777)
            staged = REMOTE + '.hamin-update-tmp'
            sftp.put(str(LOCAL), staged)
            sftp.chmod(staged, sftp.stat(REMOTE).st_mode & 0o777)
            sftp.posix_rename(staged, REMOTE)
            updated = True
        run(client, f'python3 -m py_compile {REMOTE}')
        run(client, f'systemctl restart {SERVICE}')
        run(client, f'systemctl is-active --quiet {SERVICE}')
        print('Sender updated and service active. Rollback copy:', backup)
    except Exception:
        if updated:
            with client.open_sftp() as sftp:
                with sftp.open(backup, 'rb') as handle:
                    original = handle.read()
                with sftp.open(REMOTE + '.rollback-tmp', 'wb') as handle:
                    handle.write(original)
                sftp.posix_rename(REMOTE + '.rollback-tmp', REMOTE)
            run(client, f'systemctl restart {SERVICE}')
            print('Original sender restored and service restarted.')
        raise
    finally:
        client.close()


if __name__ == '__main__':
    main()
