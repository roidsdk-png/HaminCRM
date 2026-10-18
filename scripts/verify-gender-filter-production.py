#!/usr/bin/env python3
from __future__ import annotations

import getpass
import paramiko


HOST = "5.10.249.198"
SOURCE_PAGE = "/root/socialCRM/app/[section]/page.tsx"
SOURCE_QUERY = "/root/socialCRM/lib/section-data.ts"


def main() -> None:
    password = getpass.getpass("SSH password: ")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", password=password, timeout=20)
    try:
        command = (
            "python3 -c \"from pathlib import Path; "
            f"page=Path('{SOURCE_PAGE}').read_text(); "
            f"query=Path('{SOURCE_QUERY}').read_text(); "
            "assert all(x in page for x in ('name=\\\"gender\\\"','value=\\\"female\\\"','value=\\\"male\\\"','filters.gender')); "
            "assert query.count('genderClause}') == 2; "
            "assert all(x in query for x in (\\\"'female'\\\",\\\"'male'\\\",\\\"'دختر'\\\",\\\"'پسر'\\\")); "
            "print('PASS deployed gender menu and database filters')\""
        )
        _, stdout, stderr = client.exec_command(command, timeout=30)
        output = stdout.read().decode("utf-8", "replace")
        error = stderr.read().decode("utf-8", "replace")
        status = stdout.channel.recv_exit_status()
        print(output, end="")
        if status != 0:
            raise RuntimeError(error or f"Remote check failed: {status}")
        _, stdout, stderr = client.exec_command(
            "curl -fsS http://127.0.0.1:3010/api/health", timeout=30
        )
        output = stdout.read().decode("utf-8", "replace")
        error = stderr.read().decode("utf-8", "replace")
        status = stdout.channel.recv_exit_status()
        if status != 0:
            raise RuntimeError(error or f"Health check failed: {status}")
        print(output)
    finally:
        client.close()


if __name__ == "__main__":
    main()
