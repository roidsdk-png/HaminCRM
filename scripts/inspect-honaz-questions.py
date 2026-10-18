#!/usr/bin/env python3
"""Print only the public Honaz quiz definition from the deployed frontend."""

import getpass
import paramiko


def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect('5.10.249.198', username='root', password=getpass.getpass('SSH password: '), timeout=20)
    try:
        _, stdout, stderr = client.exec_command("sed -n '1,300p' /var/www/HonazTest/dist/app.js", timeout=60)
        output = stdout.read().decode('utf-8', 'replace')
        error = stderr.read().decode('utf-8', 'replace')
        if stdout.channel.recv_exit_status() != 0:
            raise RuntimeError(error or output)
        print(output)
    finally:
        client.close()


if __name__ == '__main__':
    main()
