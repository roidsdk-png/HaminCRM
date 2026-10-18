#!/usr/bin/env python3
"""Deploy only verified CRM logo, favicon, and brand UI assets to the self-hosted server."""
from __future__ import annotations

import getpass
import posixpath
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parents[1]
DEST = '/root/socialCRM'

FILES_TO_DEPLOY = [
    'components/brand-logo.tsx',
    'components/crm-shell.tsx',
    'app/layout.tsx',
    'app/login/page.tsx',
    'app/page.tsx',
    'app/[section]/page.tsx',
    'public/favicon.svg',
    'public/favicon.ico',
    'public/logo.svg',
    'public/logo.png',
    'public/logo-dark.png',
    'public/logo-light.png',
    'public/logo-slate.png',
    'public/apple-touch-icon.png',
    'public/icon-192.png',
    'public/icon-512.png',
]


def run(client: paramiko.SSHClient, command: str, timeout: int = 1200) -> str:
    _, stdout, stderr = client.exec_command(command, timeout=timeout)
    output = stdout.read().decode('utf-8', 'replace')
    error = stderr.read().decode('utf-8', 'replace')
    if stdout.channel.recv_exit_status() != 0:
        raise RuntimeError(error or output)
    return output


def main() -> None:
    host = '5.10.249.198'
    username = 'root'
    print(f"Connecting to {username}@{host} for logo & favicon deployment...")
    password = getpass.getpass('SSH password: ')

    client = paramiko.SSHClient()
    client.load_system_host_keys()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(host, username=username, password=password, timeout=20)

    archive = ''
    changed = False
    try:
        # 1. Create backup on server
        archive = run(client, "set -eu; cd /root/socialCRM; mkdir -p backups; "
                              "stamp=$(date -u +%Y%m%dT%H%M%SZ); "
                              "archive=backups/logo-before-$stamp.tar.gz; "
                              "tar -czf \"$archive\" components/crm-shell.tsx app/layout.tsx app/login/page.tsx public/favicon.svg 2>/dev/null || true; "
                              "test -s \"$archive\"; printf '%s' \"$archive\"").strip()
        print(f"Backup created on server: {archive}")

        # 2. Upload files via SFTP
        with client.open_sftp() as sftp:
            # Ensure directories exist on server
            for subdir in ['components', 'app', 'public']:
                try:
                    sftp.stat(posixpath.join(DEST, subdir))
                except IOError:
                    sftp.mkdir(posixpath.join(DEST, subdir))

            for rel in FILES_TO_DEPLOY:
                local_file = ROOT / rel
                if not local_file.exists():
                    print(f"Skipping non-existent local file: {rel}")
                    continue
                remote_file = posixpath.join(DEST, rel)
                temp_file = remote_file + '.logo-update-tmp'
                print(f"Uploading {rel}...")
                sftp.put(str(local_file), temp_file)
                sftp.posix_rename(temp_file, remote_file)
                changed = True

        # 3. Rebuild and restart docker container
        print("Rebuilding Docker container on server...")
        print(run(client, 'cd /root/socialCRM && docker compose up -d --build', timeout=1800))

        # 4. Verify health check
        print("Checking health endpoint...")
        print(run(client, "for attempt in 1 2 3 4 5 6 7 8 9 10; do "
                          "curl -fsS http://127.0.0.1:3010/api/health && exit 0; sleep 3; done; exit 1", timeout=90))
        print("CRM Logo & Favicon update successfully deployed and verified healthy!")

    except Exception as exc:
        print(f"Error during deployment: {exc}")
        if changed and archive:
            print("Restoring server backup...")
            run(client, f"cd /root/socialCRM && tar -xzf '{archive}' && docker compose up -d --build", timeout=1800)
            print("Restored.")
        raise
    finally:
        client.close()


if __name__ == '__main__':
    main()
