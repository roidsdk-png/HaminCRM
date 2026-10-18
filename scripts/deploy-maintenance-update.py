#!/usr/bin/env python3
"""Deploy error, cache, backup, and source-management improvements with rollback."""

from __future__ import annotations

import getpass
import hashlib
import posixpath
import shlex
from pathlib import Path
import paramiko


ROOT = Path(__file__).resolve().parents[1]
DEST = "/root/socialCRM"
EXISTING = (
    "app/system/page.tsx",
    "lib/system-data.ts",
    "components/cache-manager.tsx",
    "app/sources/page.tsx",
    "app/api/admin/sources/route.ts",
)
NEW = (
    "components/ingestion-error-list.tsx",
    "app/api/admin/ingestion-errors/[id]/route.ts",
)
FILES = EXISTING + NEW


def run(client: paramiko.SSHClient, command: str, timeout: int = 1800) -> str:
    _, stdout, stderr = client.exec_command(command, timeout=timeout)
    output = stdout.read().decode("utf-8", "replace")
    error = stderr.read().decode("utf-8", "replace")
    if stdout.channel.recv_exit_status() != 0:
        raise RuntimeError((error or output)[-7000:])
    return output


def digest(sftp: paramiko.SFTPClient, path: str) -> str:
    with sftp.file(path, "rb") as handle:
        return hashlib.sha256(handle.read()).hexdigest()


def main() -> None:
    client = paramiko.SSHClient(); client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect("5.10.249.198", username="root", password=getpass.getpass("SSH password: "), timeout=20)
    code_backup = ""; database_backup = ""; database = ""; changed = False
    try:
        with client.open_sftp() as sftp:
            snapshot = {path: digest(sftp, posixpath.join(DEST, path)) for path in EXISTING}
            backups = run(client, "set -eu; cd /root/socialCRM; stamp=$(date -u +%Y%m%dT%H%M%SZ); "
                          "archive=backups/maintenance-before-$stamp.tar.gz; "
                          "tar -czf \"$archive\" " + " ".join(shlex.quote(x) for x in EXISTING) + "; "
                          "test -s \"$archive\"; python3 scripts/backup-production.py; printf '\\n%s' \"$archive\"").strip().splitlines()
            database_backup = backups[0]; code_backup = backups[-1]
            if not database_backup.startswith("/root/socialCRM/backups/socialcrm-") or not code_backup.startswith("backups/maintenance-before-"):
                raise RuntimeError("Unexpected backup path")
            for path, expected in snapshot.items():
                if digest(sftp, posixpath.join(DEST, path)) != expected:
                    raise RuntimeError(f"Production changed during preflight: {path}")
            for relative in FILES:
                destination = posixpath.join(DEST, relative)
                run(client, "mkdir -p " + shlex.quote(posixpath.dirname(destination)))
                temporary = destination + ".maintenance-tmp"
                sftp.put(str(ROOT / relative), temporary)
                sftp.posix_rename(temporary, destination)
            changed = True

        run(client, "cd /root/socialCRM && docker compose build crm")
        run(client, "cd /root/socialCRM && docker compose up -d crm")
        run(client, "for n in $(seq 1 30); do curl -fsS http://127.0.0.1:3010/api/health >/dev/null && exit 0; sleep 3; done; docker compose -f /root/socialCRM/compose.yaml logs --tail=100 crm; exit 1", timeout=150)
        database = run(client, "python3 - <<'PY'\nimport glob\np=[x for x in glob.glob('/root/socialCRM/data/v3/d1/**/*.sqlite',recursive=True) if 'metadata' not in x]\nassert len(p)==1,p\nprint(p[0])\nPY").strip()
        print("MAINTENANCE_DEPLOY_OK")
        print("CRM backup:", database_backup)
        print("Code backup:", code_backup)
    except Exception:
        if changed and database_backup and code_backup:
            print("Deployment failed; restoring code and CRM database.")
            run(client, "cd /root/socialCRM && docker compose stop crm >/dev/null 2>&1 || true")
            if not database:
                database = run(client, "python3 - <<'PY'\nimport glob\np=[x for x in glob.glob('/root/socialCRM/data/v3/d1/**/*.sqlite',recursive=True) if 'metadata' not in x]\nassert len(p)==1,p\nprint(p[0])\nPY").strip()
            run(client, "set -eu; cd /root/socialCRM; rm -f " + " ".join(shlex.quote(x) for x in NEW) + "; "
                       "tar -xzf " + shlex.quote(code_backup) + "; gzip -dc " + shlex.quote(database_backup) + " > " + shlex.quote(database + ".restore") + "; "
                       "python3 -c \"import sqlite3; d=sqlite3.connect('" + database + ".restore'); assert d.execute('PRAGMA integrity_check').fetchone()[0]=='ok'; d.close()\"; "
                       "mv " + shlex.quote(database) + " " + shlex.quote(database + ".failed-maintenance") + "; mv " + shlex.quote(database + ".restore") + " " + shlex.quote(database) + "; docker compose up -d --build crm")
        raise
    finally:
        client.close()


if __name__ == "__main__": main()
