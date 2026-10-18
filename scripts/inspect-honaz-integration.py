#!/usr/bin/env python3
"""Read-only inspection of HonazTest and CRM schemas for safe integration."""

import getpass
import paramiko
import textwrap
import uuid


REMOTE_SCRIPT = textwrap.dedent(r'''
import json, sqlite3
from pathlib import Path

HONAZ = '/var/www/HonazTest/data/quiz.db'
CRM = '/root/socialCRM/data/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite'

def inspect_database(path):
    db = sqlite3.connect(f'file:{path}?mode=ro', uri=True)
    db.row_factory = sqlite3.Row
    tables = []
    for table in db.execute("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"):
        name = table['name']
        columns = [dict(row) for row in db.execute(f'PRAGMA table_info("{name}")')]
        count = db.execute(f'SELECT COUNT(*) FROM "{name}"').fetchone()[0]
        indexes = [dict(row) for row in db.execute(f'PRAGMA index_list("{name}")')]
        tables.append({'name': name, 'count': count, 'columns': columns, 'indexes': indexes, 'createSql': table['sql']})
    db.close()
    return tables

honaz = sqlite3.connect(f'file:{HONAZ}?mode=ro', uri=True)
honaz.row_factory = sqlite3.Row
samples = {}
for table in honaz.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"):
    name = table['name']
    row = honaz.execute(f'SELECT * FROM "{name}" LIMIT 1').fetchone()
    if row:
        samples[name] = {key: {'type': type(row[key]).__name__, 'length': len(str(row[key])) if row[key] is not None else 0,
                               'jsonKeys': list(json.loads(row[key]).keys()) if isinstance(row[key], str) and row[key].lstrip().startswith('{') and isinstance(json.loads(row[key]), dict) else None}
                         for key in row.keys()}
honaz.close()

crm = sqlite3.connect(f'file:{CRM}?mode=ro', uri=True)
crm.row_factory = sqlite3.Row
sources = [dict(row) for row in crm.execute("SELECT id,slug,name,kind,platform,status,datetime(last_seen_at,'unixepoch','localtime') last_seen FROM sources ORDER BY slug")]
crm.close()

package = json.loads(Path('/var/www/HonazTest/package.json').read_text())
print(json.dumps({'honazTables': inspect_database(HONAZ), 'sampleShapes': samples,
                  'crmSources': sources, 'package': {'name': package.get('name'), 'scripts': package.get('scripts'),
                  'dependencies': package.get('dependencies')}}, ensure_ascii=False, indent=2))
''')


def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect('5.10.249.198', username='root', password=getpass.getpass('SSH password: '), timeout=20)
    remote_path = f'/tmp/inspect-honaz-{uuid.uuid4().hex}.py'
    try:
        with client.open_sftp() as sftp:
            with sftp.file(remote_path, 'w') as handle:
                handle.write(REMOTE_SCRIPT)
        _, stdout, stderr = client.exec_command(f'python3 {remote_path}; rm -f {remote_path}', timeout=120)
        output = stdout.read().decode('utf-8', 'replace')
        error = stderr.read().decode('utf-8', 'replace')
        if stdout.channel.recv_exit_status() != 0:
            raise RuntimeError(error or output)
        print(output)
    finally:
        client.close()


if __name__ == '__main__':
    main()
