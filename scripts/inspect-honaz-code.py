#!/usr/bin/env python3
"""Read-only inspection of Honaz source structure and submission flow."""

import getpass
import paramiko


COMMAND = r'''
set -eu
printf '[files]\n'
find /var/www/HonazTest \( -path '*/node_modules' -o -path '*/.git' -o -path '*/data' \) -prune -o -type f -print | sort
printf '\n[db-module]\n'
sed -n '1,260p' /var/www/HonazTest/server/db.js
printf '\n[server-submission-references]\n'
grep -n -B 18 -A 45 -E 'submission|submit|feedback' /var/www/HonazTest/server/index.js | head -500
printf '\n[source-question-references]\n'
grep -n -B 3 -A 12 -E 'const questions|questions =|question:|dimensions|archetype|سؤال|سوال|prompt|question_text|quizData' /var/www/HonazTest/dist/app.js 2>/dev/null | head -1600 || true
printf '\n[score-engine]\n'
sed -n '1,520p' /var/www/HonazTest/server/score_engine.py
'''


def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect('5.10.249.198', username='root', password=getpass.getpass('SSH password: '), timeout=20)
    try:
        _, stdout, stderr = client.exec_command(COMMAND, timeout=120)
        output = stdout.read().decode('utf-8', 'replace')
        error = stderr.read().decode('utf-8', 'replace')
        if stdout.channel.recv_exit_status() != 0:
            raise RuntimeError(error or output)
        print(output)
    finally:
        client.close()


if __name__ == '__main__':
    main()
