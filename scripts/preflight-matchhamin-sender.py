#!/usr/bin/env python3
"""Read-only preflight of the live matchmaking bot CRM sender."""
from __future__ import annotations

import getpass
import paramiko


def main() -> None:
    client = paramiko.SSHClient()
    client.load_system_host_keys()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect('5.10.249.72', username='root', password=getpass.getpass('SSH password: '), timeout=20)
    try:
        checks = {
            'service files': "systemctl list-unit-files --type=service --no-pager | grep -Ei 'match|hamin|bot' | head -30",
            'processes': "ps -eo pid,comm,args | grep -Ei '[m]atchhamin|[p]ython.*bot' | head -25",
            'bot directory': "find /opt/matchhamin-bot -maxdepth 2 -type f -printf '%P\\n' | head -45",
            'outbox config': "grep -n -E 'outbox_dir|crm-outbox' /opt/matchhamin-bot/crm_reporter.py | head -15",
            'outbox count': "find /opt/matchhamin-bot/crm-outbox -maxdepth 1 -name '*.json' -type f 2>/dev/null | wc -l",
            'service state': "systemctl is-active matchhamin-bot.service",
        }
        for label, command in checks.items():
            _, stdout, _ = client.exec_command(command, timeout=20)
            output = stdout.read().decode('utf-8', 'replace').strip()
            print(f'{label}: {output[:1800]}')
    finally:
        client.close()


if __name__ == '__main__':
    main()
