#!/usr/bin/env python3
"""Extract concise question candidates from retained Honaz bundles."""

import getpass
import json
import paramiko
import re


def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect("5.10.249.198", username="root", password=getpass.getpass("SSH password: "), timeout=20)
    try:
        command = r"grep -RIl --include='*.js' -E 'تعهد و وفاداری عاطفی|توازن سنتی-مدرن' /var/www/HonazTest/dist /var/www/HonazTest/backups 2>/dev/null"
        _, stdout, _ = client.exec_command(command, timeout=30)
        files = [line.strip() for line in stdout.read().decode().splitlines() if line.strip()]
        result = {}
        with client.open_sftp() as sftp:
            for path in files:
                with sftp.file(path, "rb") as handle:
                    text = handle.read().decode("utf-8", "replace")
                strings = []
                for match in re.finditer(r"(['\"`])((?:\\.|(?!\1).){8,400}?)\1", text):
                    value = match.group(2).replace(r"\'", "'").replace(r'\"', '"')
                    if "؟" in value and re.search(r"[آ-ی]", value) and "<" not in value:
                        value = re.sub(r"\\[nrt]", " ", value)
                        value = re.sub(r"\s+", " ", value).strip()
                        if 15 <= len(value) <= 300 and value not in strings:
                            strings.append(value)
                if strings:
                    result[path] = strings
        print(json.dumps(result, ensure_ascii=False, indent=2))
    finally:
        client.close()


if __name__ == "__main__":
    main()
