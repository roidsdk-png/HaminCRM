#!/usr/bin/env python3
"""Safely deploy and verify the read-only Honaz-to-CRM integration."""

from __future__ import annotations

import getpass
import hashlib
import json
import posixpath
import secrets
import shlex
import time
from pathlib import Path

import paramiko


ROOT = Path(__file__).resolve().parents[1]
DEST = "/root/socialCRM"
FILES = (
    "compose.yaml",
    "Dockerfile",
    "app/page.tsx",
    "app/[section]/[id]/page.tsx",
    "scripts/honaz-sync.py",
    "integrations/honaz/questions.json",
    "integrations/honaz/legacy-questions.json",
)
EXISTING_FILES = FILES[:4]


def run(client: paramiko.SSHClient, command: str, timeout: int = 1800) -> str:
    _, stdout, stderr = client.exec_command(command, timeout=timeout)
    output = stdout.read().decode("utf-8", "replace")
    error = stderr.read().decode("utf-8", "replace")
    if stdout.channel.recv_exit_status() != 0:
        raise RuntimeError((error or output)[-6000:])
    return output


def remote_hash(sftp: paramiko.SFTPClient, path: str) -> str:
    with sftp.file(path, "rb") as handle:
        return hashlib.sha256(handle.read()).hexdigest()


def set_env(content: str, values: dict[str, str]) -> str:
    lines = content.splitlines()
    seen: set[str] = set()
    result: list[str] = []
    for line in lines:
        key = line.split("=", 1)[0].strip() if "=" in line and not line.lstrip().startswith("#") else ""
        if key in values:
            result.append(f"{key}={values[key]}")
            seen.add(key)
        else:
            result.append(line)
    for key, value in values.items():
        if key not in seen:
            result.append(f"{key}={value}")
    return "\n".join(result).rstrip() + "\n"


def main() -> None:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect("5.10.249.198", username="root", password=getpass.getpass("SSH password: "), timeout=20)
    code_backup = ""
    database_backup = ""
    database = ""
    changed = False
    crm_key = secrets.token_urlsafe(48)
    ip_key = secrets.token_urlsafe(48)
    try:
        with client.open_sftp() as sftp:
            snapshot = {relative: remote_hash(sftp, posixpath.join(DEST, relative)) for relative in EXISTING_FILES}
            with sftp.file(posixpath.join(DEST, ".dev.vars"), "rb") as handle:
                env_before = handle.read().decode("utf-8")
            source_check = run(client, "python3 - <<'PY'\n"
                               "import glob,sqlite3\n"
                               "p=[x for x in glob.glob('/root/socialCRM/data/v3/d1/**/*.sqlite',recursive=True) if 'metadata' not in x]\n"
                               "assert len(p)==1,p\n"
                               "d=sqlite3.connect(p[0]); print(d.execute(\"SELECT COUNT(*) FROM sources WHERE slug='honaz-test'\").fetchone()[0]); d.close()\n"
                               "PY").strip()
            if source_check != "0":
                raise RuntimeError("The honaz-test source already exists; refusing an ambiguous redeploy")

            public_before = run(client, "curl -fsS https://test.aifluxa.ir/ | sha256sum | cut -d' ' -f1").strip()
            backup_lines = run(
                client,
                "set -eu; cd /root/socialCRM; mkdir -p backups; "
                "stamp=$(date -u +%Y%m%dT%H%M%SZ); archive=backups/honaz-integration-before-$stamp.tar.gz; "
                "tar -czf \"$archive\" compose.yaml Dockerfile app/page.tsx 'app/[section]/[id]/page.tsx' .dev.vars; "
                "test -s \"$archive\"; python3 scripts/backup-production.py; printf '\\n%s' \"$archive\"",
            ).strip().splitlines()
            database_backup = backup_lines[0]
            code_backup = backup_lines[-1]
            if not database_backup.startswith("/root/socialCRM/backups/socialcrm-"):
                raise RuntimeError("Unexpected CRM backup path")
            if not code_backup.startswith("backups/honaz-integration-before-"):
                raise RuntimeError("Unexpected code backup path")

            # Recheck the exact production snapshot immediately before replacing files.
            for relative, digest in snapshot.items():
                if remote_hash(sftp, posixpath.join(DEST, relative)) != digest:
                    raise RuntimeError(f"Production changed during preflight: {relative}")

            for relative in FILES:
                destination = posixpath.join(DEST, relative)
                parent = posixpath.dirname(destination)
                run(client, "mkdir -p " + shlex.quote(parent))
                temporary = destination + ".honaz-tmp"
                sftp.put(str(ROOT / relative), temporary)
                sftp.posix_rename(temporary, destination)
            env_after = set_env(env_before, {"HONAZ_CRM_KEY": crm_key, "HONAZ_IP_HASH_KEY": ip_key})
            env_tmp = posixpath.join(DEST, ".dev.vars.honaz-tmp")
            with sftp.file(env_tmp, "wb") as handle:
                handle.write(env_after.encode("utf-8"))
            sftp.chmod(env_tmp, 0o600)
            sftp.posix_rename(env_tmp, posixpath.join(DEST, ".dev.vars"))
            changed = True

        run(client, "cd /root/socialCRM && docker compose config -q && docker compose build crm honaz-sync")
        run(client, "cd /root/socialCRM && docker compose stop crm honaz-sync >/dev/null 2>&1 || true")
        database = run(client, "python3 - <<'PY'\n"
                       "import glob\n"
                       "p=[x for x in glob.glob('/root/socialCRM/data/v3/d1/**/*.sqlite',recursive=True) if 'metadata' not in x]\n"
                       "assert len(p)==1,p\n"
                       "print(p[0])\n"
                       "PY").strip()
        source_hash = hashlib.sha256(crm_key.encode()).hexdigest()
        insert_script = (
            "import sqlite3,time\n"
            f"p={database!r}\n"
            "d=sqlite3.connect(p); d.execute('PRAGMA busy_timeout=10000')\n"
            "now=int(time.time()*1000)\n"
            f"d.execute(\"INSERT INTO sources(id,slug,name,kind,platform,status,credential_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)\","
            f"('src_honaz_test','honaz-test','آزمون هوناز','test','web','active',{source_hash!r},now,now))\n"
            "d.commit(); assert d.execute(\"SELECT name FROM sources WHERE slug='honaz-test'\").fetchone()[0]=='آزمون هوناز'; d.close()\n"
        )
        with client.open_sftp() as sftp:
            remote_script = "/tmp/register-honaz-source.py"
            with sftp.file(remote_script, "wb") as handle:
                handle.write(insert_script.encode("utf-8"))
        run(client, f"python3 {remote_script}; rm -f {remote_script}")
        run(client, "cd /root/socialCRM && docker compose up -d crm honaz-sync")
        run(client, "for n in $(seq 1 30); do curl -fsS http://127.0.0.1:3010/api/health >/dev/null && [ \"$(docker inspect -f '{{.State.Health.Status}}' hamin-honaz-crm-sync 2>/dev/null)\" = healthy ] && exit 0; sleep 3; done; docker compose -f /root/socialCRM/compose.yaml logs --tail=80 honaz-sync; exit 1", timeout=150)
        time.sleep(2)
        verification = run(client, "python3 - <<'PY'\n"
                           "import glob,json,sqlite3\n"
                           "h=sqlite3.connect('file:/var/www/HonazTest/data/quiz.db?mode=ro',uri=True)\n"
                           "h.row_factory=sqlite3.Row\n"
                           "source_attempts=h.execute('SELECT COUNT(*) FROM submissions').fetchone()[0]\n"
                           "source_answers=sum(len(json.loads(r['answers_json'] or '{}')) for r in h.execute('SELECT answers_json FROM submissions'))\n"
                           "source_feedback=h.execute('SELECT COUNT(*) FROM feedbacks').fetchone()[0]\n"
                           "h.close()\n"
                           "p=[x for x in glob.glob('/root/socialCRM/data/v3/d1/**/*.sqlite',recursive=True) if 'metadata' not in x][0]\n"
                           "d=sqlite3.connect(p); d.row_factory=sqlite3.Row\n"
                           "row=d.execute(\"SELECT id,name,status,last_seen_at FROM sources WHERE slug='honaz-test'\").fetchone(); assert row\n"
                           "attempts=d.execute(\"SELECT COUNT(*) FROM test_attempts WHERE source_id=? AND test_key='honaz-test'\",(row['id'],)).fetchone()[0]\n"
                           "answers=d.execute(\"SELECT COUNT(*) FROM test_answers a JOIN test_attempts t ON t.id=a.attempt_id WHERE t.source_id=? AND t.test_key='honaz-test'\",(row['id'],)).fetchone()[0]\n"
                           "feedback=d.execute(\"SELECT COUNT(*) FROM ingestion_events WHERE source_id=? AND type='test.feedback.created' AND processing_status='processed'\",(row['id'],)).fetchone()[0]\n"
                           "failed=d.execute(\"SELECT COUNT(*) FROM ingestion_events WHERE source_id=? AND processing_status='failed'\",(row['id'],)).fetchone()[0]\n"
                           "raw_ip=d.execute(\"SELECT COUNT(*) FROM test_attempts WHERE source_id=? AND profile LIKE '%client_ip%'\",(row['id'],)).fetchone()[0]\n"
                           "result={'sourceAttempts':source_attempts,'crmAttempts':attempts,'sourceAnswers':source_answers,'crmAnswers':answers,'sourceFeedback':source_feedback,'crmFeedback':feedback,'failedEvents':failed,'rawIpMarkers':raw_ip,'sourceName':row['name'],'status':row['status'],'lastSeen':row['last_seen_at']}\n"
                           "assert attempts==source_attempts,result; assert answers==source_answers,result; assert feedback==source_feedback,result; assert failed==0,result; assert raw_ip==0,result\n"
                           "print(json.dumps(result,ensure_ascii=False)); d.close()\n"
                           "PY")
        public_after = run(client, "curl -fsS https://test.aifluxa.ir/ | sha256sum | cut -d' ' -f1").strip()
        if public_before != public_after:
            raise RuntimeError("Honaz public application response changed unexpectedly")
        print("HONAZ_INTEGRATION_OK")
        print(verification.strip())
        print("CRM backup:", database_backup)
        print("Code backup:", code_backup)
    except Exception:
        if changed and database_backup and code_backup:
            print("Deployment failed; restoring CRM code, environment, and database.")
            run(client, "cd /root/socialCRM && docker compose stop crm honaz-sync >/dev/null 2>&1 || true")
            if database:
                run(client, "set -eu; cd /root/socialCRM; tar -xzf " + shlex.quote(code_backup) + "; "
                           "gzip -dc " + shlex.quote(database_backup) + " > " + shlex.quote(database + ".restore") + "; "
                           "python3 -c \"import sqlite3; d=sqlite3.connect('" + database + ".restore'); assert d.execute('PRAGMA integrity_check').fetchone()[0]=='ok'; d.close()\"; "
                           "mv " + shlex.quote(database) + " " + shlex.quote(database + ".failed-honaz") + "; "
                           "mv " + shlex.quote(database + ".restore") + " " + shlex.quote(database) + "; docker compose up -d --build crm")
            else:
                run(client, "cd /root/socialCRM && tar -xzf " + shlex.quote(code_backup) + " && docker compose up -d --build crm")
        raise
    finally:
        client.close()


if __name__ == "__main__":
    main()
