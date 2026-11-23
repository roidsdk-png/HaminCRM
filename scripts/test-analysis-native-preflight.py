"""Check the deployment inspector against disposable, synthetic CRM databases."""

import json
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts/analysis-native-preflight.py"


class NativePreflightAcceptance(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="crm-native-preflight-")
        self.root = Path(self.temp.name)
        self.token = "synthetic-private-token-" + "x" * 40
        for name in (
            "dist/server/index.js",
            "dist/server/wrangler.json",
            "wrangler.local.jsonc",
            "node_modules/wrangler/bin/wrangler.js",
            "scripts/backup-service.py",
            "scripts/analysis-sync.py",
            "analytics/app.py",
        ):
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("synthetic fixture", encoding="utf-8")
        self.database = self.root / "data/v3/d1/miniflare-D1DatabaseObject/qa.sqlite"
        self.database.parent.mkdir(parents=True)
        with closing(sqlite3.connect(self.database)) as connection:
            for table in ("sources", "contacts", "messages", "test_attempts"):
                connection.execute(f"CREATE TABLE {table}(id TEXT PRIMARY KEY)")
        self.crm_env = "\n".join(
            f"{key}={value}"
            for key, value in {
                "SESSION_SECRET": self.token,
                "BACKUP_SERVICE_TOKEN": self.token,
                "ANALYTICS_INTERNAL_TOKEN": self.token,
                "ANALYTICS_SERVICE_URL": "http://127.0.0.1:8091",
            }.items()
        )
        (self.root / ".dev.vars").write_text(self.crm_env, encoding="utf-8")
        (self.root / "analytics.env").write_text(
            "ANALYTICS_INTERNAL_TOKEN=" + self.token, encoding="utf-8"
        )

    def tearDown(self):
        self.temp.cleanup()

    def run_check(self):
        result = subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                "--root",
                str(self.root),
                "--analytics-python",
                sys.executable,
            ],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertNotIn(self.token, result.stdout + result.stderr)
        return result.returncode, json.loads(result.stdout)

    @unittest.skipUnless(
        shutil.which("node"), "Node is required for deployment inspection"
    )
    def test_valid_preflight_is_read_only_and_hides_secret_values(self):
        before = self.database.read_bytes()
        status, result = self.run_check()
        self.assertEqual(status, 0, result)
        self.assertTrue(result["ok"])
        self.assertEqual(result["checks"]["databaseQuickCheck"], "ok")
        self.assertEqual(self.database.read_bytes(), before)
        self.assertFalse(
            (
                self.root / "data/v3/d1/miniflare-D1DatabaseObject/qa.sqlite-journal"
            ).exists()
        )

    def test_mismatched_internal_token_is_reported_without_value(self):
        (self.root / "analytics.env").write_text(
            "ANALYTICS_INTERNAL_TOKEN=wrong", encoding="utf-8"
        )
        status, result = self.run_check()
        self.assertEqual(status, 1)
        self.assertFalse(result["checks"]["internalTokensMatch"])

    def test_multiple_database_candidates_are_rejected(self):
        with closing(sqlite3.connect(self.database.with_name("another.sqlite"))):
            pass
        status, result = self.run_check()
        self.assertEqual(status, 1)
        self.assertEqual(result["checks"]["crmDatabaseCount"], 2)

    def test_nonlocal_private_api_url_is_rejected(self):
        (self.root / ".dev.vars").write_text(
            self.crm_env.replace(
                "http://127.0.0.1:8091", "https://example.invalid:8091"
            ),
            encoding="utf-8",
        )
        status, result = self.run_check()
        self.assertEqual(status, 1)
        self.assertIn(
            "Native analytics service URL must be loopback-only.", result["failures"]
        )


if __name__ == "__main__":
    unittest.main()
