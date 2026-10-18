#!/usr/bin/env python3
"""Read/write test against a disposable SQLite database, never production."""
from __future__ import annotations

import gzip
import importlib.util
import sqlite3
import tempfile
from contextlib import closing
from pathlib import Path

service_path = Path(__file__).with_name("backup-service.py")
spec = importlib.util.spec_from_file_location("backup_service", service_path)
assert spec and spec.loader
service = importlib.util.module_from_spec(spec)
spec.loader.exec_module(service)

with tempfile.TemporaryDirectory(prefix="socialcrm-backup-test-") as temporary:
    root = Path(temporary)
    service.DATA_ROOT = root / "data"
    service.BACKUP_ROOT = root / "backups"
    service.DATA_ROOT.mkdir()
    db_path = service.DATA_ROOT / "crm.sqlite"
    with closing(sqlite3.connect(db_path)) as db:
        db.execute("CREATE TABLE records(id INTEGER PRIMARY KEY, content TEXT)")
        db.execute("INSERT INTO records(content) VALUES ('CRM test record')")
        db.commit()
    created = service.snapshot()
    name = str(created["name"])
    assert service.backup_file(name).exists()
    assert len(service.list_backups()) == 1
    assert (service.BACKUP_ROOT / f"{name}.sha256").is_file()
    with gzip.open(service.backup_file(name), "rb") as compressed:
        restored = root / "restored.sqlite"
        restored.write_bytes(compressed.read())
    with closing(sqlite3.connect(restored)) as db:
        assert db.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert db.execute("SELECT content FROM records").fetchone()[0] == "CRM test record"
    for invalid in ("../crm.sqlite", "metadata.sqlite", "socialcrm-invalid.sqlite.gz"):
        try:
            service.backup_file(invalid)
        except ValueError:
            pass
        else:
            raise AssertionError(f"Unsafe backup name accepted: {invalid}")
    service.backup_file(name).unlink()
    assert service.list_backups() == []
    with closing(sqlite3.connect(db_path)) as db:
        assert db.execute("SELECT COUNT(*) FROM records").fetchone()[0] == 1

print("PASS full CRM snapshot, checksum, safe filenames, isolated deletion, integrity")
