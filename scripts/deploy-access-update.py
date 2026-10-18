#!/usr/bin/env python3
from __future__ import annotations

import getpass
import pathlib
import sys
import time

import paramiko


HOST = "5.10.249.198"
USER = "root"
LOCAL_ARCHIVE = pathlib.Path(__file__).resolve().parents[1] / "access-management-update.tar.gz"
LOCAL_LEGACY_ARCHIVE = pathlib.Path(__file__).resolve().parents[1] / "legacy-tests-data.tar.gz"
REMOTE_ARCHIVE = "/tmp/access-management-update.tar.gz"
REMOTE_LEGACY_ARCHIVE = "/tmp/legacy-tests-data.tar.gz"
DATABASE = "/root/socialCRM/data/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite"


def run(client: paramiko.SSHClient, command: str, timeout: int = 900) -> str:
    stdin, stdout, stderr = client.exec_command(command, timeout=timeout)
    del stdin
    output = stdout.read().decode("utf-8", "replace")
    error = stderr.read().decode("utf-8", "replace")
    status = stdout.channel.recv_exit_status()
    if output:
        print(output, end="")
    if error:
        print(error, end="", file=sys.stderr)
    if status != 0:
        raise RuntimeError(f"Remote command failed with exit status {status}")
    return output


def main() -> None:
    if not LOCAL_ARCHIVE.is_file():
        raise FileNotFoundError(LOCAL_ARCHIVE)

    password = getpass.getpass("SSH password: ")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=password, timeout=20)
    try:
        print("Uploading release archive...")
        with client.open_sftp() as sftp:
            sftp.put(str(LOCAL_ARCHIVE), REMOTE_ARCHIVE)
            if LOCAL_LEGACY_ARCHIVE.is_file():
                sftp.put(str(LOCAL_LEGACY_ARCHIVE), REMOTE_LEGACY_ARCHIVE)

        print("Creating code and database backups...")
        run(
            client,
            "set -eu; stamp=$(date -u +%Y%m%dT%H%M%SZ); "
            "mkdir -p /root/socialCRM/backups; "
            "tar --exclude='./data' --exclude='./backups' --exclude='./node_modules' "
            "--exclude='./dist' --exclude='./.wrangler' -czf \"/root/socialCRM/backups/code-before-access-$stamp.tar.gz\" "
            "-C /root/socialCRM .; "
            "python3 /root/socialCRM/scripts/backup-production.py; "
            "chmod 600 /root/socialCRM/backups/*before-access*",
        )

        print("Provisioning the private CRM backup-service token if absent...")
        run(
            client,
            "python3 -c \"from pathlib import Path; import secrets; "
            "p=Path('/root/socialCRM/.dev.vars'); "
            "contents=p.read_text(); "
            "needs_token=not any(line.strip().startswith('BACKUP_SERVICE_TOKEN=') for line in contents.splitlines()); "
            "p.open('a').write(('\\n' if not contents.endswith('\\n') else '') + 'BACKUP_SERVICE_TOKEN=' + secrets.token_hex(32) + '\\n') if needs_token else None; "
            "p.chmod(0o600)\"",
        )

        print("Deploying and rebuilding the CRM container...")
        run(
            client,
            f"set -eu; tar -xzf {REMOTE_ARCHIVE} -C /root/socialCRM; "
            "cd /root/socialCRM; docker compose up -d --build; rm -f " + REMOTE_ARCHIVE,
            timeout=1800,
        )

        print("Waiting for container health...")
        for _ in range(18):
            state = run(
                client,
                "docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' hamin-social-crm",
                timeout=30,
            ).strip()
            if state == "healthy":
                break
            if state in {"unhealthy", "exited", "dead"}:
                raise RuntimeError(f"Container state is {state}")
            time.sleep(5)
        else:
            raise RuntimeError("Container did not become healthy in time")

        print("Verifying migration and database integrity...")
        run(
            client,
            f"set -eu; python3 -c \"import sqlite3; c=sqlite3.connect('file:{DATABASE}?mode=ro', uri=True); "
            "cols={r[1] for r in c.execute('PRAGMA table_info(administrators)')}; "
            "assert 'password_hash' in cols; assert c.execute('PRAGMA integrity_check').fetchone()[0]=='ok'; c.close()\"; "
            "curl -fsS http://127.0.0.1:3010/api/health",
        )

        if LOCAL_LEGACY_ARCHIVE.is_file():
            print("Importing all legacy psychology-test records...")
            run(
                client,
                "set -eu; cd /root/socialCRM; docker compose stop crm >/dev/null; "
                "trap 'docker compose start crm >/dev/null' EXIT; "
                "rm -rf /tmp/legacy-tests-import; mkdir -p /tmp/legacy-tests-import; "
                f"tar -xzf {REMOTE_LEGACY_ARCHIVE} -C /tmp/legacy-tests-import; "
                f"python3 scripts/import-legacy-tests.py --database {DATABASE} --input /tmp/legacy-tests-import/psytest123; "
                "docker compose start crm >/dev/null; trap - EXIT; "
                f"rm -rf /tmp/legacy-tests-import; rm -f {REMOTE_LEGACY_ARCHIVE}",
                timeout=900,
            )
            print("Waiting for CRM after historical import...")
            for _ in range(18):
                state = run(
                    client,
                    "docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' hamin-social-crm",
                    timeout=30,
                ).strip()
                if state == "healthy":
                    break
                if state in {"unhealthy", "exited", "dead"}:
                    raise RuntimeError(f"Container state is {state}")
                time.sleep(5)
            else:
                raise RuntimeError("Container did not become healthy after import")

            run(
                client,
                f"python3 -c \"import sqlite3; c=sqlite3.connect('file:{DATABASE}?mode=ro', uri=True); "
                "rows=dict(c.execute(\\\"SELECT s.slug,COUNT(*) FROM test_attempts t JOIN sources s ON s.id=t.source_id WHERE s.slug IN ('psytest-1','psytest-2','psytest-3') GROUP BY s.slug\\\")); "
                "assert rows.get('psytest-1',0)>=3291 and rows.get('psytest-2',0)>=2361 and rows.get('psytest-3',0)>=297, rows; "
                "assert c.execute('PRAGMA integrity_check').fetchone()[0]=='ok'; print(rows); c.close()\"; "
                "curl -fsS http://127.0.0.1:3010/api/health",
            )
        print("\nDeployment completed successfully.")
    finally:
        client.close()


if __name__ == "__main__":
    main()
