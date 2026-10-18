#!/usr/bin/env python3
"""Inspect only structural versions of stored Honaz submissions, without values."""

import getpass
import paramiko
import textwrap
import uuid


REMOTE = textwrap.dedent(r'''
import collections, json, sqlite3
db=sqlite3.connect('file:/var/www/HonazTest/data/quiz.db?mode=ro',uri=True)
db.row_factory=sqlite3.Row
answer_shapes=collections.Counter(); dimension_shapes=collections.Counter(); genders=collections.Counter(); ranges={}
for row in db.execute('SELECT id,gender,answers_json,dimensions_json,timestamp FROM submissions ORDER BY id'):
    answers=json.loads(row['answers_json'] or '{}'); dimensions=json.loads(row['dimensions_json'] or '[]')
    answer_shapes[tuple(answers.keys())]+=1
    dimension_shapes[tuple((str(x.get('id','')),str(x.get('label','')),tuple(sorted(x.keys()))) for x in dimensions if isinstance(x,dict))]+=1
    genders[row['gender']]+=1
    signature=(tuple(answers.keys()),row['gender'])
    current=ranges.setdefault(str(signature),[row['id'],row['id'],row['timestamp'],row['timestamp']])
    current[0]=min(current[0],row['id']);current[1]=max(current[1],row['id']);current[2]=min(current[2],row['timestamp']);current[3]=max(current[3],row['timestamp'])
print(json.dumps({'answerShapes':[{'keys':list(k),'count':v} for k,v in answer_shapes.items()],
 'dimensionShapes':[{'dimensions':[{'id':x[0],'label':x[1],'keys':list(x[2])} for x in k],'count':v} for k,v in dimension_shapes.items()],
 'genders':genders,'ranges':ranges},ensure_ascii=False,indent=2))
''')


def main():
    client=paramiko.SSHClient();client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect('5.10.249.198',username='root',password=getpass.getpass('SSH password: '),timeout=20)
    path=f'/tmp/honaz-shapes-{uuid.uuid4().hex}.py'
    try:
        with client.open_sftp() as sftp:
            with sftp.file(path,'w') as handle: handle.write(REMOTE)
        _,stdout,stderr=client.exec_command(f'python3 {path}; rm -f {path}',timeout=60)
        output=stdout.read().decode('utf-8','replace');error=stderr.read().decode('utf-8','replace')
        if stdout.channel.recv_exit_status()!=0: raise RuntimeError(error or output)
        print(output)
    finally: client.close()


if __name__=='__main__': main()
