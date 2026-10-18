#!/usr/bin/env python3
"""Locate legacy Honaz quiz definitions in retained public assets."""

import getpass
import paramiko


COMMAND = r'''
set -eu
printf '[matching-files]\n'
grep -RIl --include='*.js' -E 'تعهد و وفاداری عاطفی|توازن سنتی-مدرن' /var/www/HonazTest/dist /var/www/HonazTest/backups 2>/dev/null || true
printf '\n[question-like-strings]\n'
for file in $(grep -RIl --include='*.js' -E 'تعهد و وفاداری عاطفی|توازن سنتی-مدرن' /var/www/HonazTest/dist /var/www/HonazTest/backups 2>/dev/null | head -10); do
  printf '\nFILE=%s\n' "$file"
  grep -oE "[^\"']{12,180}[؟?][^\"']{0,220}" "$file" 2>/dev/null | head -80 || true
done
'''


def main():
    client=paramiko.SSHClient();client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect('5.10.249.198',username='root',password=getpass.getpass('SSH password: '),timeout=20)
    try:
        _,stdout,stderr=client.exec_command(COMMAND,timeout=120)
        output=stdout.read().decode('utf-8','replace');error=stderr.read().decode('utf-8','replace')
        if stdout.channel.recv_exit_status()!=0: raise RuntimeError(error or output)
        print(output)
    finally: client.close()


if __name__=='__main__': main()
