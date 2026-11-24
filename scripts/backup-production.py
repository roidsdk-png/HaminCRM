#!/usr/bin/env python3
"""Back up CRM SQLite and private analytics state without Docker."""

from __future__ import annotations

import gzip
import hashlib
import re
import shutil
import sqlite3
import sys
import tarfile
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path


ROOT = Path("/root/socialCRM")
DATA_ROOT = ROOT / "data" / "v3" / "d1"
BACKUP_ROOT = ROOT / "backups"
RETENTION_DAYS = 30
BACKUP_NAME = re.compile(
    r"(?:socialcrm-\d{8}T\d{6}Z\.sqlite\.gz|analytics-\d{8}T\d{6}Z\.tar\.gz)(?:\.sha256)?\Z"
)


def find_database() -> Path:
    candidates = [
        path
        for path in DATA_ROOT.rglob("*.sqlite")
        if path.name != "metadata.sqlite" and "metadata" not in path.parts
    ]
    if len(candidates) != 1:
        raise RuntimeError(f"Expected exactly one CRM database, found {len(candidates)}")
    return candidates[0]


def sqlite_snapshot(source_path: Path, temporary_path: Path) -> None:
    source = sqlite3.connect(source_path.resolve().as_uri() + "?mode=ro", uri=True)
    destination = sqlite3.connect(temporary_path)
    try:
        source.backup(destination)
        result = destination.execute("PRAGMA integrity_check").fetchone()
        if not result or result[0] != "ok":
            raise RuntimeError("SQLite backup integrity check failed")
    finally:
        destination.close()
        source.close()


def write_checksum(archive_path: Path) -> None:
    digest = hashlib.sha256()
    with archive_path.open("rb") as raw:
        for chunk in iter(lambda: raw.read(1024 * 1024), b""):
            digest.update(chunk)
    checksum_path = archive_path.with_suffix(archive_path.suffix + ".sha256")
    checksum_path.write_text(
        f"{digest.hexdigest()}  {archive_path.name}\n", encoding="ascii"
    )
    checksum_path.chmod(0o600)

def private_member(member: tarfile.TarInfo) -> tarfile.TarInfo:
    if not member.isfile():
        raise RuntimeError("Analytics backup only accepts regular files")
    member.mode = 0o600
    member.uid = member.gid = 0
    member.uname = member.gname = ""
    return member


def analytics_archive(stamp: str, temporary: Path) -> Path:
    archive_path = BACKUP_ROOT / f"analytics-{stamp}.tar.gz"
    temporary_archive = temporary / archive_path.name
    with tarfile.open(temporary_archive, "w:gz") as archive:
        database = ROOT / "analytics-data/analytics.sqlite"
        if database.exists():
            snapshot = temporary / "analytics.sqlite"
            sqlite_snapshot(database, snapshot)
            archive.add(snapshot, arcname="analytics-data/analytics.sqlite", filter=private_member)
        files = [ROOT / ".dev.vars", ROOT / "analytics.env", ROOT / "analytics-data/provider-settings.json"]
        guides = ROOT / "analytics-data/guides"
        if guides.is_symlink():
            raise RuntimeError("Analytics guides directory must not be a symlink")
        if guides.is_dir():
            files.extend(sorted(path for path in guides.rglob("*") if not path.is_dir() or path.is_symlink()))
        for path in files:
            if path.is_symlink():
                raise RuntimeError("Private analytics backup must not follow symlinks")
            if path.is_file():
                archive.add(path, arcname=path.relative_to(ROOT).as_posix(), recursive=False, filter=private_member)
    temporary_archive.chmod(0o600)
    temporary_archive.replace(archive_path)
    write_checksum(archive_path)
    return archive_path


def main() -> None:
    source_path = find_database()
    BACKUP_ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    archive_path = BACKUP_ROOT / f"socialcrm-{stamp}.sqlite.gz"
    with tempfile.TemporaryDirectory(prefix=".backup-", dir=BACKUP_ROOT) as directory:
        temporary = Path(directory)
        temporary.chmod(0o700)
        snapshot = temporary / "crm.sqlite"
        sqlite_snapshot(source_path, snapshot)
        temporary_archive = temporary / archive_path.name
        with snapshot.open("rb") as raw, gzip.open(temporary_archive, "wb", compresslevel=9) as compressed:
            shutil.copyfileobj(raw, compressed)
        temporary_archive.chmod(0o600)
        temporary_archive.replace(archive_path)
        write_checksum(archive_path)
        private_archive = analytics_archive(stamp, temporary)

    cutoff = datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS)
    for path in BACKUP_ROOT.iterdir():
        if path.is_file() and not path.is_symlink() and BACKUP_NAME.fullmatch(path.name):
            if datetime.fromtimestamp(path.stat().st_mtime, timezone.utc) < cutoff:
                path.unlink()

    print(archive_path)
    print(private_archive)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"CRM backup failed: {error}", file=sys.stderr)
        raise
