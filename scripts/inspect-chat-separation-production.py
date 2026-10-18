#!/usr/bin/env python3
"""Read-only preflight for the chat identity deployment."""

import getpass
import hashlib
import difflib
from pathlib import Path

import paramiko


ROOT = Path(__file__).resolve().parents[1]
FILES = (
    "lib/ingestion.ts",
    "db/schema.ts",
    "lib/section-data.ts",
    "app/[section]/page.tsx",
    "app/[section]/[id]/page.tsx",
    "drizzle/meta/_journal.json",
    "scripts/repair-chat-separation.py",
)


def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect("5.10.249.198", username="root", password=getpass.getpass("SSH password: "), timeout=20)
    try:
        sftp = client.open_sftp()
        for relative in FILES:
            local = (ROOT / relative).read_bytes()
            with sftp.open("/root/socialCRM/" + relative, "rb") as handle:
                remote = handle.read()
            print("REMOTE_SHA", relative, hashlib.sha256(remote).hexdigest())
            if relative == "scripts/repair-chat-separation.py":
                print(hashlib.sha256(remote).hexdigest())
            print(relative, hashlib.sha256(remote).hexdigest(), hashlib.sha256(local).hexdigest(), "same" if remote == local else "different")
            if remote != local:
                for line in difflib.unified_diff(remote.decode().splitlines(), local.decode().splitlines(), n=1):
                    print(line)
        sftp.close()
    finally:
        client.close()


if __name__ == "__main__":
    main()
