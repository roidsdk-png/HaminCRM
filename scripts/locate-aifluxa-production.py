#!/usr/bin/env python3
"""Read-only locator for test.aifluxa.ir on the known production server."""

import getpass
import paramiko


COMMANDS = {
    "nginx": "nginx -T 2>/dev/null | grep -n -B 8 -A 24 'test\\.aifluxa\\.ir' || true",
    "configs": "grep -RIn --exclude='*.log' 'test.aifluxa.ir' /etc/nginx /etc/apache2 /usr/local/directadmin/data/users 2>/dev/null | head -80 || true",
    "folders": "find /root /var/www /home -maxdepth 6 -type d \\( -iname '*aifluxa*' -o -iname '*honaz*' -o -iname '*hoonaz*' \\) 2>/dev/null | head -100",
    "services": "systemctl list-units --type=service --all --no-pager 2>/dev/null | grep -Ei 'aifluxa|honaz|node|pm2' || true; docker ps --format '{{.Names}} {{.Image}} {{.Ports}}' 2>/dev/null || true; ps -eo pid,user,args --sort=pid | grep -Ei 'aifluxa|honaz|node|next|vite' | grep -v grep | head -100 || true",
    "project": "printf 'cwd: '; readlink -f /proc/$(pgrep -f '/var/www/HonazTest/server/index.js' | head -1)/cwd 2>/dev/null || true; find /var/www/HonazTest -maxdepth 2 -type f -printf '%p\\n' 2>/dev/null | sort | head -120; printf '\\nPM2:\\n'; pm2 jlist 2>/dev/null | python3 -c \"import json,sys; data=json.load(sys.stdin); print(json.dumps([{'name':x.get('name'),'cwd':x.get('pm2_env',{}).get('pm_cwd'),'script':x.get('pm2_env',{}).get('pm_exec_path'),'status':x.get('pm2_env',{}).get('status')} for x in data],ensure_ascii=False,indent=2))\" || true",
}


def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect("5.10.249.198", username="root", password=getpass.getpass("SSH password: "), timeout=20)
    try:
        for label, command in COMMANDS.items():
            _, stdout, stderr = client.exec_command(command, timeout=120)
            output = stdout.read().decode("utf-8", "replace")
            error = stderr.read().decode("utf-8", "replace")
            print(f"\n[{label}]\n{output}{error}")
    finally:
        client.close()


if __name__ == "__main__":
    main()
