#!/usr/bin/env python3
"""Complete legacy Eitaa message matching after the contact-aware deployment."""

import getpass
import hashlib
from pathlib import Path

import paramiko


ROOT = Path(__file__).resolve().parents[1]
REMOTE = "/root/socialCRM/scripts/repair-chat-separation.py"
DATABASE = "/root/socialCRM/data/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite"
EXPECTED = "7c9511eed7b0584f3e39cff77606c50bec979e7af7892243ae8658abd1c8869f"


def run(client, command, timeout=300):
    _, stdout, stderr = client.exec_command(command, timeout=timeout)
    output = stdout.read().decode("utf-8", "replace")
    error = stderr.read().decode("utf-8", "replace")
    if stdout.channel.recv_exit_status() != 0:
        raise RuntimeError((error or output)[-4000:])
    return output


def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect("5.10.249.198", username="root", password=getpass.getpass("SSH password: "), timeout=20)
    backup = ""
    stopped = False
    try:
        sftp = client.open_sftp()
        with sftp.open(REMOTE, "rb") as handle:
            if hashlib.sha256(handle.read()).hexdigest() != EXPECTED:
                raise RuntimeError("Production repair script changed after preflight")
        backup = run(client, "python3 /root/socialCRM/scripts/backup-production.py").strip()
        if not backup.startswith("/root/socialCRM/backups/socialcrm-") or not backup.endswith(".sqlite.gz"):
            raise RuntimeError("Unexpected database backup path")
        staged = REMOTE + ".legacy-tmp"
        sftp.put(str(ROOT / "scripts/repair-chat-separation.py"), staged)
        sftp.posix_rename(staged, REMOTE)
        sftp.close()
        run(client, "cd /root/socialCRM && docker compose stop crm")
        stopped = True
        repair = run(client, f"python3 {REMOTE} {DATABASE} --apply")
        run(client, "cd /root/socialCRM && docker compose up -d crm")
        stopped = False
        health = run(client, "for n in 1 2 3 4 5 6 7 8 9 10; do curl -fsS http://127.0.0.1:3010/api/health && exit 0; sleep 3; done; exit 1", 90)
        print("repair:", repair.strip())
        print("health:", health.strip())
        print("backup:", backup)
    except Exception:
        if stopped and backup:
            run(client, f"gzip -dc '{backup}' > '{DATABASE}.restore' && mv '{DATABASE}' '{DATABASE}.legacy-failed' && mv '{DATABASE}.restore' '{DATABASE}'")
            run(client, "cd /root/socialCRM && docker compose up -d crm")
        raise
    finally:
        client.close()


if __name__ == "__main__":
    main()
