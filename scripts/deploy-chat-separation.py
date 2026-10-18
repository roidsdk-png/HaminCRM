#!/usr/bin/env python3
"""Deploy contact-aware chat separation, repair legacy rows, and verify production."""

import getpass
import hashlib
import posixpath
from pathlib import Path

import paramiko


ROOT = Path(__file__).resolve().parents[1]
DEST = "/root/socialCRM"
DATABASE = "/root/socialCRM/data/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite"
EXPECTED = {
    "lib/ingestion.ts": "c58f5b40f418f6c8661f1d359c39b2b2c84b04ba51422869d20b5504c8628f8b",
    "db/schema.ts": "d1793172e8d6d91d518e2995abaa2ddee5f2da25b09639be89ad3a2957bf022d",
    "lib/section-data.ts": "1a70670a824a6e8f9d1d4faa57150dcdd9fd286bc0a5ff3156401107358cc44f",
    "app/[section]/page.tsx": "e0c7850fd4b95cd4572363718b2f31f99700dccc073754c5571231db984b3aaa",
    "app/[section]/[id]/page.tsx": "90083fdf1cb182ec153e31ed0b3d7123d2fb975ac520948669c73089724a4c2b",
    "drizzle/meta/_journal.json": "86fccb8d4b057913128f77ddc0e34d47506e9a51aa6863b1e3f52b03956478e4",
}
NEW_FILES = (
    "drizzle/0004_nostalgic_miek.sql",
    "drizzle/meta/0004_snapshot.json",
    "scripts/repair-chat-separation.py",
)
FILES = tuple(EXPECTED) + NEW_FILES


def run(client, command, timeout=1800):
    _, stdout, stderr = client.exec_command(command, timeout=timeout)
    output = stdout.read().decode("utf-8", "replace")
    error = stderr.read().decode("utf-8", "replace")
    if stdout.channel.recv_exit_status() != 0:
        raise RuntimeError((error or output)[-5000:])
    return output


def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect("5.10.249.198", username="root", password=getpass.getpass("SSH password: "), timeout=20)
    code_backup = ""
    database_backup = ""
    changed = False
    try:
        sftp = client.open_sftp()
        for relative, expected in EXPECTED.items():
            with sftp.open(posixpath.join(DEST, relative), "rb") as handle:
                actual = hashlib.sha256(handle.read()).hexdigest()
            if actual != expected:
                raise RuntimeError(f"Production file changed after preflight: {relative}")

        backup_output = run(
            client,
            "set -eu; cd /root/socialCRM; mkdir -p backups; "
            "stamp=$(date -u +%Y%m%dT%H%M%SZ); archive=backups/chat-separation-code-before-$stamp.tar.gz; "
            "tar -czf \"$archive\" " + " ".join("'" + path + "'" for path in EXPECTED) + "; "
            "test -s \"$archive\"; python3 scripts/backup-production.py; printf '\\n%s' \"$archive\"",
        ).strip().splitlines()
        database_backup = backup_output[0].strip()
        code_backup = backup_output[-1].strip()
        if not database_backup.startswith("/root/socialCRM/backups/socialcrm-") or not database_backup.endswith(".sqlite.gz"):
            raise RuntimeError("Unexpected database backup path")
        if not code_backup.startswith("backups/chat-separation-code-before-") or not code_backup.endswith(".tar.gz"):
            raise RuntimeError("Unexpected code backup path")

        for relative in FILES:
            destination = posixpath.join(DEST, relative)
            staged = destination + ".hamin-chat-tmp"
            sftp.put(str(ROOT / relative), staged)
            sftp.posix_rename(staged, destination)
        sftp.close()
        changed = True

        run(client, "cd /root/socialCRM && docker compose build crm")
        run(client, "cd /root/socialCRM && docker compose stop crm")
        migration = run(
            client,
            "cd /root/socialCRM && docker compose run --rm --no-deps crm "
            "npx wrangler d1 migrations apply DB --local --persist-to /data --config wrangler.local.jsonc",
        )
        repair = run(client, f"python3 /root/socialCRM/scripts/repair-chat-separation.py {DATABASE} --apply")
        run(client, "cd /root/socialCRM && docker compose up -d crm")
        health = run(
            client,
            "for attempt in 1 2 3 4 5 6 7 8 9 10 11 12; do "
            "curl -fsS http://127.0.0.1:3010/api/health && exit 0; sleep 3; done; exit 1",
            timeout=120,
        )
        verify = run(
            client,
            "python3 -c \"import sqlite3,json; d=sqlite3.connect('" + DATABASE + "'); "
            "mixed=d.execute('SELECT COUNT(*) FROM (SELECT m.conversation_id FROM messages m JOIN ingestion_events e ON e.id=m.id JOIN sources s ON s.id=m.source_id WHERE s.platform=\\\"eitaa\\\" AND s.kind=\\\"chatbot\\\" AND json_extract(e.payload,\\\"$.ipHash\\\") IS NOT NULL GROUP BY m.conversation_id HAVING COUNT(DISTINCT json_extract(e.payload,\\\"$.ipHash\\\"))>1)').fetchone()[0]; "
            "mismatch=d.execute('SELECT COUNT(*) FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE COALESCE(m.contact_id,\\\"\\\")<>COALESCE(c.contact_id,\\\"\\\")').fetchone()[0]; "
            "print(json.dumps({\\\"mixedConversations\\\":mixed,\\\"contactMismatches\\\":mismatch}))\"",
        )
        print("migration:", migration.strip()[-1200:])
        print("repair:", repair.strip())
        print("verify:", verify.strip())
        print("health:", health.strip())
        print("backups:", database_backup, code_backup)
    except Exception:
        if changed and database_backup and code_backup:
            print("Deployment failed; restoring code and database backup.")
            run(client, "cd /root/socialCRM && docker compose stop crm || true")
            run(
                client,
                "set -eu; cd /root/socialCRM; "
                "rm -f " + " ".join("'" + path + "'" for path in NEW_FILES) + "; "
                f"tar -xzf '{code_backup}'; gzip -dc '{database_backup}' > '{DATABASE}.restore'; "
                f"python3 -c \"import sqlite3; d=sqlite3.connect('{DATABASE}.restore'); assert d.execute('PRAGMA integrity_check').fetchone()[0]=='ok'; d.close()\"; "
                f"mv '{DATABASE}' '{DATABASE}.failed'; mv '{DATABASE}.restore' '{DATABASE}'; "
                "docker compose up -d --build crm",
            )
        raise
    finally:
        client.close()


if __name__ == "__main__":
    main()
