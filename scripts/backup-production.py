#!/usr/bin/env python3
"""Create a consistent online backup of the production D1 SQLite database."""

from __future__ import annotations

import gzip
import hashlib
import shutil
import sqlite3
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path


ROOT = Path("/root/socialCRM")
DATA_ROOT = ROOT / "data" / "v3" / "d1"
BACKUP_ROOT = ROOT / "backups"
RETENTION_DAYS = 30


def find_database() -> Path:
    candidates = [
        path
        for path in DATA_ROOT.rglob("*.sqlite")
        if path.name != "metadata.sqlite" and "metadata" not in path.parts
    ]
    if len(candidates) != 1:
        raise RuntimeError(f"Expected exactly one CRM database, found {len(candidates)}")
    return candidates[0]


def main() -> None:
    source_path = find_database()
    BACKUP_ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    temporary_path = BACKUP_ROOT / f"socialcrm-{stamp}.sqlite.tmp"
    archive_path = BACKUP_ROOT / f"socialcrm-{stamp}.sqlite.gz"

    source = sqlite3.connect(f"file:{source_path}?mode=ro", uri=True)
    destination = sqlite3.connect(temporary_path)
    try:
        source.backup(destination)
        result = destination.execute("PRAGMA integrity_check").fetchone()
        if not result or result[0] != "ok":
            raise RuntimeError("Backup integrity check failed")
    finally:
        destination.close()
        source.close()

    with temporary_path.open("rb") as raw, gzip.open(archive_path, "wb", compresslevel=9) as compressed:
        shutil.copyfileobj(raw, compressed)
    temporary_path.unlink()
    archive_path.chmod(0o600)

    digest = hashlib.sha256(archive_path.read_bytes()).hexdigest()
    checksum_path = archive_path.with_suffix(archive_path.suffix + ".sha256")
    checksum_path.write_text(
        f"{digest}  {archive_path.name}\n", encoding="ascii"
    )
    checksum_path.chmod(0o600)

    cutoff = datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS)
    for path in BACKUP_ROOT.glob("socialcrm-*"):
        if datetime.fromtimestamp(path.stat().st_mtime, timezone.utc) < cutoff:
            path.unlink()

    print(archive_path)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"CRM backup failed: {error}", file=sys.stderr)
        raise
