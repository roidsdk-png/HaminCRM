#!/usr/bin/env python3
"""Show only intended maintenance differences before production deployment."""

import difflib
import getpass
from pathlib import Path
import posixpath
import paramiko


ROOT = Path(__file__).resolve().parents[1]
FILES = [
    "app/system/page.tsx",
    "lib/system-data.ts",
    "components/cache-manager.tsx",
    "app/sources/page.tsx",
    "app/api/admin/sources/route.ts",
]


def main():
    client = paramiko.SSHClient(); client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect("5.10.249.198", username="root", password=getpass.getpass("SSH password: "), timeout=20)
    try:
        with client.open_sftp() as sftp:
            for relative in FILES:
                with sftp.file(posixpath.join("/root/socialCRM", relative), "rb") as handle:
                    remote = handle.read().decode("utf-8").splitlines()
                local = (ROOT / relative).read_text(encoding="utf-8").splitlines()
                print("\n".join(difflib.unified_diff(remote, local, fromfile="production/" + relative,
                                                      tofile="local/" + relative, n=1)))
    finally:
        client.close()


if __name__ == "__main__": main()
