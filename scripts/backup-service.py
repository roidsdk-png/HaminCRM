#!/usr/bin/env python3
"""Loopback-only management of consistent snapshots of the CRM SQLite database."""
from __future__ import annotations

import gzip
import hashlib
import hmac
import json
import os
import re
import shutil
import sqlite3
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

DATA_ROOT = Path(os.environ.get("CRM_DATA_ROOT", "/data/v3/d1"))
BACKUP_ROOT = Path(os.environ.get("CRM_BACKUP_ROOT", "/backups"))
NAME = re.compile(r"socialcrm-\d{8}T\d{6}Z\.sqlite\.gz\Z")
TOKEN = os.environ.get("BACKUP_SERVICE_TOKEN", "")


def database_path() -> Path:
    candidates = [p for p in DATA_ROOT.rglob("*.sqlite") if p.name != "metadata.sqlite" and "metadata" not in p.parts]
    if len(candidates) != 1:
        raise RuntimeError(f"Expected one CRM database, found {len(candidates)}")
    return candidates[0]


def snapshot() -> dict[str, object]:
    BACKUP_ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    name = f"socialcrm-{stamp}.sqlite.gz"
    archive = BACKUP_ROOT / name
    if archive.exists():
        raise FileExistsError("A backup was already created this second")
    temporary = BACKUP_ROOT / f"socialcrm-{stamp}.sqlite.tmp"
    source = sqlite3.connect(f"file:{database_path()}?mode=ro", uri=True)
    destination = sqlite3.connect(temporary)
    try:
        source.backup(destination)
        if destination.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise RuntimeError("CRM backup integrity check failed")
    finally:
        source.close()
        destination.close()
    try:
        with temporary.open("rb") as raw, gzip.open(archive, "wb", compresslevel=6) as compressed:
            shutil.copyfileobj(raw, compressed)
        archive.chmod(0o600)
        digest = hashlib.sha256(archive.read_bytes()).hexdigest()
        checksum = BACKUP_ROOT / f"{name}.sha256"
        checksum.write_text(f"{digest}  {name}\n", encoding="ascii")
        checksum.chmod(0o600)
        return entry(archive)
    finally:
        temporary.unlink(missing_ok=True)


def backup_file(name: str) -> Path:
    if not NAME.fullmatch(name):
        raise ValueError("Invalid CRM backup filename")
    path = BACKUP_ROOT / name
    if not path.is_file() or path.is_symlink():
        raise FileNotFoundError(name)
    return path


def entry(path: Path) -> dict[str, object]:
    return {"name": path.name, "bytes": path.stat().st_size, "createdAt": datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat()}


def list_backups() -> list[dict[str, object]]:
    if not BACKUP_ROOT.is_dir():
        return []
    return sorted((entry(p) for p in BACKUP_ROOT.iterdir() if NAME.fullmatch(p.name) and p.is_file() and not p.is_symlink()), key=lambda x: str(x["name"]), reverse=True)


class Handler(BaseHTTPRequestHandler):
    def authorized(self) -> bool:
        supplied = self.headers.get("X-Backup-Service-Token", "")
        if not TOKEN or not hmac.compare_digest(supplied, TOKEN):
            self.send_error(403)
            return False
        return True

    def json(self, status: int, payload: object) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def route(self) -> tuple[str, str | None]:
        path = urlsplit(self.path).path
        if path == "/backups":
            return "backups", None
        if path.startswith("/backups/"):
            return "file", unquote(path[len("/backups/"):])
        return "missing", None

    def do_GET(self) -> None:
        if not self.authorized():
            return
        kind, name = self.route()
        try:
            if kind == "backups":
                self.json(200, {"backups": list_backups()})
            elif kind == "file" and name:
                path = backup_file(name)
                self.send_response(200)
                self.send_header("Content-Type", "application/gzip")
                self.send_header("Content-Disposition", f'attachment; filename="{name}"')
                self.send_header("Content-Length", str(path.stat().st_size))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                with path.open("rb") as raw:
                    shutil.copyfileobj(raw, self.wfile)
            else:
                self.send_error(404)
        except (FileNotFoundError, ValueError):
            self.send_error(404)

    def do_POST(self) -> None:
        if not self.authorized():
            return
        kind, _ = self.route()
        if kind != "backups":
            self.send_error(404)
            return
        try:
            self.json(201, {"backup": snapshot()})
        except Exception as error:
            self.json(500, {"error": str(error)})

    def do_DELETE(self) -> None:
        if not self.authorized():
            return
        kind, name = self.route()
        if kind != "file" or not name:
            self.send_error(404)
            return
        try:
            path = backup_file(name)
            path.unlink()
            (BACKUP_ROOT / f"{name}.sha256").unlink(missing_ok=True)
            self.json(200, {"deleted": name})
        except (FileNotFoundError, ValueError):
            self.send_error(404)


if __name__ == "__main__":
    if len(TOKEN) < 32:
        raise SystemExit("BACKUP_SERVICE_TOKEN must contain at least 32 characters")
    ThreadingHTTPServer(("127.0.0.1", 9898), Handler).serve_forever()
