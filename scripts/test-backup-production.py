"""Restore real WAL-backed databases from native private backups in a temp folder."""

import contextlib
import gzip
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sqlite3
import tarfile
import tempfile
import time
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location(
    "backup_production", Path(__file__).with_name("backup-production.py")
)
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


class NativeBackupAcceptance(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.data = self.root / "data/v3/d1/object"
        self.data.mkdir(parents=True)
        self.backups = self.root / "backups"
        self.backups.mkdir()
        self.stack = contextlib.ExitStack()
        self.addCleanup(self.stack.close)
        for name, value in (
            ("ROOT", self.root),
            ("DATA_ROOT", self.root / "data/v3/d1"),
            ("BACKUP_ROOT", self.backups),
        ):
            self.stack.enter_context(patch.object(backup, name, value))
        self.crm = self.live_database(self.data / "crm.sqlite", "crm WAL record")

    def live_database(self, path, value):
        path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(path)
        self.addCleanup(connection.close)
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA wal_autocheckpoint=0")
        connection.execute("CREATE TABLE entries(value TEXT)")
        connection.execute("INSERT INTO entries VALUES(?)", (value,))
        connection.commit()
        self.assertTrue(Path(str(path) + "-wal").is_file())
        return connection

    def restore_value(self, raw, name):
        restored = self.root / name
        restored.write_bytes(raw)
        with contextlib.closing(sqlite3.connect(restored)) as connection:
            self.assertEqual(connection.execute("PRAGMA integrity_check").fetchone()[0], "ok")
            return connection.execute("SELECT value FROM entries").fetchone()[0]

    def test_restores_wal_data_and_private_settings_with_restricted_retention(self):
        self.live_database(self.root / "analytics-data/analytics.sqlite", "analytics WAL record")
        guide = self.root / "analytics-data/guides/version-one.json"
        guide.parent.mkdir()
        guide.write_text('{"version":1}', encoding="utf-8")
        provider = self.root / "analytics-data/provider-settings.json"
        provider.write_text(json.dumps({"provider": "custom", "apiKey": "synthetic-private-fixture"}))
        (self.root / ".dev.vars").write_text("SESSION_SECRET=synthetic-session\n")
        (self.root / "analytics.env").write_text("ANALYTICS_INTERNAL_TOKEN=synthetic-token\n")
        managed = [
            self.backups / "socialcrm-20000101T000000Z.sqlite.gz",
            self.backups / "socialcrm-20000101T000000Z.sqlite.gz.sha256",
            self.backups / "analytics-20000101T000000Z.tar.gz",
            self.backups / "analytics-20000101T000000Z.tar.gz.sha256",
        ]
        unrelated = [self.backups / "socialcrm-manual-note.txt", self.backups / "analytics-custom.tar.gz"]
        for path in managed + unrelated:
            path.write_text("old fixture")
            old = time.time() - 40 * 86400
            os.utime(path, (old, old))
        with contextlib.redirect_stdout(io.StringIO()):
            # A whole-file read would regress large-database memory usage.
            with patch.object(Path, "read_bytes", side_effect=AssertionError("Use streaming checksum")):
                backup.main()
        self.assertTrue(all(not path.exists() for path in managed))
        self.assertTrue(all(path.is_file() for path in unrelated))
        crm_archive = next(self.backups.glob("socialcrm-*.sqlite.gz"))
        with gzip.open(crm_archive, "rb") as compressed:
            self.assertEqual(self.restore_value(compressed.read(), "restored-crm.sqlite"), "crm WAL record")
        private_archive = next(self.backups.glob("analytics-????????T??????Z.tar.gz"))
        with tarfile.open(private_archive) as archive:
            names = set(archive.getnames())
            self.assertEqual(names, {
                "analytics-data/analytics.sqlite", "analytics-data/guides/version-one.json",
                "analytics-data/provider-settings.json", ".dev.vars", "analytics.env",
            })
            self.assertTrue(all(member.mode == 0o600 for member in archive.getmembers()))
            self.assertEqual(
                self.restore_value(archive.extractfile("analytics-data/analytics.sqlite").read(), "restored-analytics.sqlite"),
                "analytics WAL record",
            )
            settings = json.load(archive.extractfile("analytics-data/provider-settings.json"))
            self.assertEqual(settings["apiKey"], "synthetic-private-fixture")
        for path in (crm_archive, private_archive):
            checksum = path.with_suffix(path.suffix + ".sha256")
            self.assertEqual(checksum.read_text().split()[0], hashlib.sha256(path.read_bytes()).hexdigest())
            if os.name != "nt":
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)
                self.assertEqual(checksum.stat().st_mode & 0o777, 0o600)
        api_spec = importlib.util.spec_from_file_location(
            "private_backup_api_acceptance", Path(__file__).with_name("backup-service.py")
        )
        service = importlib.util.module_from_spec(api_spec)
        api_spec.loader.exec_module(service)
        service.BACKUP_ROOT = self.backups
        self.assertEqual([item["name"] for item in service.list_backups()], [crm_archive.name])
        with self.assertRaises(ValueError):
            service.backup_file(private_archive.name)

    def test_does_not_publish_corrupt_analytics_database(self):
        database = self.root / "analytics-data/analytics.sqlite"
        database.parent.mkdir()
        database.write_text("not a SQLite database")
        with self.assertRaises(sqlite3.DatabaseError):
            backup.main()
        self.assertEqual(list(self.backups.glob("analytics-*.tar.gz")), [])
        self.assertEqual(list(self.backups.glob(".backup-*")), [])


if __name__ == "__main__":
    unittest.main()
