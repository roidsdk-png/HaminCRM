#!/usr/bin/env python3
from __future__ import annotations

import getpass
import sys
import textwrap

import paramiko


HOST = "5.10.249.198"
USER = "root"

REMOTE_TEST = r'''
import http.cookiejar
import json
import sqlite3
import time
import urllib.error
import urllib.request
from pathlib import Path

BASE = "https://crm.haminyar.ir"
DB = "/root/socialCRM/data/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite"

def read_vars(path):
    result = {}
    for raw in Path(path).read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        result[key.strip()] = value.strip().strip("\"'")
    return result

def opener():
    jar = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

def request(client, method, path, body=None):
    data = None if body is None else json.dumps(body).encode()
    headers = {"Accept": "application/json", "Origin": BASE}
    if data is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with client.open(req, timeout=30) as response:
            return response.status, response.read(), dict(response.headers)
    except urllib.error.HTTPError as error:
        return error.code, error.read(), dict(error.headers)

def expect(label, actual, expected):
    if actual != expected:
        raise AssertionError(f"{label}: expected {expected}, got {actual}")
    print(f"PASS {label}")

def page_contains(page, phrase):
    text = page.decode("utf-8")
    escaped = json.dumps(phrase, ensure_ascii=True)[1:-1]
    return phrase in text or escaped in text

env = read_vars("/root/socialCRM/.dev.vars")
owner_password = env["ADMIN_PASSWORD"]
owner_email = env.get("ADMIN_EMAIL", "")
test_email = f"access-check-{int(time.time())}@example.test"
test_password = "Production-Access-Test-2026!"
admin_id = None

owner = opener()
viewer = opener()
manager = opener()
try:
    status, _, _ = request(owner, "POST", "/api/admin/auth/login", {"email": owner_email, "password": owner_password})
    expect("owner login", status, 200)
    expect("users weekly filter", request(owner, "GET", "/users?range=7")[0], 200)
    expect("conversations fortnight filter", request(owner, "GET", "/conversations?range=14")[0], 200)
    expect("tests monthly filter", request(owner, "GET", "/tests?range=30")[0], 200)
    expect("matchmaking custom date filter", request(owner, "GET", "/matchmaking?from=2026-09-01&to=2026-09-14")[0], 200)
    expect("matchmaking female filter", request(owner, "GET", "/matchmaking?gender=female")[0], 200)
    expect("matchmaking male filter", request(owner, "GET", "/matchmaking?gender=male")[0], 200)

    status, payload, _ = request(owner, "POST", "/api/admin/administrators", {"email": test_email, "role": "viewer", "password": test_password})
    expect("create viewer", status, 200)
    admin_id = json.loads(payload)["administrator"]["id"]

    status, _, _ = request(viewer, "POST", "/api/admin/auth/login", {"email": test_email, "password": test_password})
    expect("viewer login", status, 200)
    expect("viewer source read", request(viewer, "GET", "/api/admin/sources")[0], 200)
    expect("viewer source write blocked", request(viewer, "POST", "/api/admin/sources", {})[0], 403)
    expect("viewer backup blocked", request(viewer, "GET", "/api/admin/backup")[0], 403)
    expect("viewer admin write blocked", request(viewer, "POST", "/api/admin/administrators", {})[0], 403)
    status, page, _ = request(viewer, "GET", "/access")
    expect("viewer access page response", status, 200)
    if not page_contains(page, "عدم دسترسی به این بخش"):
        raise AssertionError("viewer access page did not show denial")
    print("PASS viewer access page denied")

    status, _, _ = request(owner, "POST", "/api/admin/administrators", {"email": test_email, "role": "manager"})
    expect("promote viewer to manager", status, 200)
    expect("old viewer session revoked", request(viewer, "GET", "/api/admin/sources")[0], 403)

    expect("manager login", request(manager, "POST", "/api/admin/auth/login", {"email": test_email, "password": test_password})[0], 200)
    expect("manager source validation reached", request(manager, "POST", "/api/admin/sources", {})[0], 400)
    expect("manager backup blocked", request(manager, "GET", "/api/admin/backup")[0], 403)
    status, page, _ = request(manager, "GET", "/system")
    expect("manager system page response", status, 200)
    if page_contains(page, "دسترسی شما غیرفعال یا ناکافی است"):
        raise AssertionError("manager was incorrectly denied from system page")
    print("PASS manager system page allowed")

    status, backup, _ = request(owner, "GET", "/api/admin/backup")
    expect("owner backup", status, 200)
    backup_text = backup.decode("utf-8")
    if "passwordHash" in backup_text or "password_hash" in backup_text:
        raise AssertionError("credential hash leaked into backup")
    print("PASS backup excludes credential hashes")

    expect("deactivate manager", request(owner, "PATCH", "/api/admin/administrators", {"id": admin_id, "active": False})[0], 200)
    expect("deactivated session revoked", request(manager, "GET", "/api/admin/sources")[0], 403)
finally:
    if admin_id:
        connection = sqlite3.connect(DB, timeout=30)
        try:
            connection.execute("DELETE FROM administrators WHERE id = ? AND email = ?", (admin_id, test_email))
            connection.commit()
        finally:
            connection.close()
        print("PASS temporary account removed")
'''


def main() -> None:
    password = getpass.getpass("SSH password: ")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=password, timeout=20)
    try:
        stdin, stdout, stderr = client.exec_command("python3 -", timeout=300)
        stdin.write(textwrap.dedent(REMOTE_TEST))
        stdin.channel.shutdown_write()
        output = stdout.read().decode("utf-8", "replace")
        error = stderr.read().decode("utf-8", "replace")
        status = stdout.channel.recv_exit_status()
        print(output, end="")
        if error:
            print(error, end="", file=sys.stderr)
        if status != 0:
            raise SystemExit(status)

        stdin, stdout, stderr = client.exec_command(
            "cd /root/socialCRM && set -a && . ./.dev.vars && set +a && "
            "CRM_TEST_URL=https://crm.haminyar.ir CRM_TEST_PASSWORD=\"$ADMIN_PASSWORD\" npm run test:smoke && "
            "python3 -c \"import sqlite3; p='/root/socialCRM/data/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite'; "
            "c=sqlite3.connect('file:'+p+'?mode=ro', uri=True); assert c.execute('PRAGMA integrity_check').fetchone()[0]=='ok'; c.close(); print('PASS database integrity')\"",
            timeout=300,
        )
        del stdin
        output = stdout.read().decode("utf-8", "replace")
        error = stderr.read().decode("utf-8", "replace")
        status = stdout.channel.recv_exit_status()
        print(output, end="")
        if error:
            print(error, end="", file=sys.stderr)
        if status != 0:
            raise SystemExit(status)
    finally:
        client.close()


if __name__ == "__main__":
    main()
