"""Read-only checks before switching an existing CRM to native systemd services."""

import argparse
import json
import re
import shutil
import sqlite3
import subprocess
import sys
from contextlib import closing
from pathlib import Path
from urllib.parse import urlsplit


def read_environment(path):
    if not path.is_file():
        return {}
    result = {}
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        if not line.strip() or line.lstrip().startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        result[name.strip()] = value.strip().strip('"').strip("'")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--data-root", type=Path)
    parser.add_argument("--analytics-python", type=Path)
    args = parser.parse_args()
    root = args.root.resolve()
    data_root = (args.data_root or root / "data").resolve()
    failures = []
    checks = {}

    required = (
        "dist/server/index.js",
        "dist/server/wrangler.json",
        "wrangler.local.jsonc",
        "node_modules/wrangler/bin/wrangler.js",
        "scripts/backup-service.py",
        "scripts/analysis-sync.py",
        "analytics/app.py",
    )
    for name in required:
        if not (root / name).is_file():
            failures.append(f"Missing deployment file: {name}")
    checks["runtimeFilesPresent"] = not failures

    node = shutil.which("node")
    if node:
        result = subprocess.run(
            [node, "--version"], capture_output=True, text=True, check=False
        )
        match = re.fullmatch(r"v(\d+)\.(\d+)\.(\d+)\s*", result.stdout)
        version = tuple(map(int, match.groups())) if match else (0, 0, 0)
        checks["nodeVersion"] = ".".join(map(str, version))
        if result.returncode or version < (22, 13, 0):
            failures.append("Node 22.13.0 or newer is required.")
    else:
        failures.append("Node executable is missing.")

    python = args.analytics_python or root / ".venv-analytics" / (
        "Scripts/python.exe" if sys.platform == "win32" else "bin/python"
    )
    if python.is_file():
        result = subprocess.run(
            [
                str(python),
                "-c",
                "import sys,fastapi,uvicorn,httpx,tzdata; assert sys.version_info >= (3,11); print(sys.version.split()[0])",
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode:
            failures.append(
                "Analytics Python 3.11+ and required modules must be installed."
            )
        else:
            checks["analyticsPythonVersion"] = result.stdout.strip()
    else:
        failures.append("Analytics virtual environment is missing.")

    crm = read_environment(root / ".dev.vars")
    analytic = read_environment(root / "analytics.env")
    for key, minimum in (("SESSION_SECRET", 32), ("BACKUP_SERVICE_TOKEN", 32)):
        if len(crm.get(key, "")) < minimum:
            failures.append(f"{key} is missing or shorter than {minimum} characters.")
    token = crm.get("ANALYTICS_INTERNAL_TOKEN", "")
    checks["internalTokensMatch"] = bool(
        len(token) >= 24 and token == analytic.get("ANALYTICS_INTERNAL_TOKEN")
    )
    if not checks["internalTokensMatch"]:
        failures.append(
            "CRM and analytics internal tokens must match and be at least 24 characters."
        )
    target = urlsplit(crm.get("ANALYTICS_SERVICE_URL", ""))
    if (
        target.scheme not in {"http", "https"}
        or target.hostname not in {"127.0.0.1", "localhost", "::1"}
        or target.username
        or target.password
        or target.query
        or target.fragment
    ):
        failures.append("Native analytics service URL must be loopback-only.")

    candidates = [
        path
        for path in (data_root / "v3/d1").rglob("*.sqlite")
        if path.name != "metadata.sqlite" and "metadata" not in path.parts
    ]
    checks["crmDatabaseCount"] = len(candidates)
    if len(candidates) != 1:
        failures.append(
            "Expected exactly one existing CRM SQLite database under the preserved data root."
        )
    else:
        database = candidates[0].resolve()
        if not database.is_relative_to(data_root):
            failures.append(
                "CRM SQLite database resolves outside the specified data root."
            )
        else:
            with closing(
                sqlite3.connect(database.as_uri() + "?mode=ro", uri=True)
            ) as connection:
                checks["databaseQuickCheck"] = connection.execute(
                    "PRAGMA quick_check"
                ).fetchone()[0]
                tables = {
                    row[0]
                    for row in connection.execute(
                        "SELECT name FROM sqlite_master WHERE type='table'"
                    )
                }
                checks["requiredTablesPresent"] = {
                    "sources",
                    "contacts",
                    "messages",
                    "test_attempts",
                }.issubset(tables)
                if (
                    checks["databaseQuickCheck"] != "ok"
                    or not checks["requiredTablesPresent"]
                ):
                    failures.append(
                        "Existing CRM SQLite structure or integrity check failed."
                    )
                if "d1_migrations" in tables:
                    checks["migrationCount"] = connection.execute(
                        "SELECT COUNT(*) FROM d1_migrations"
                    ).fetchone()[0]
    print(
        json.dumps(
            {"ok": not failures, "checks": checks, "failures": failures},
            ensure_ascii=False,
            indent=2,
        )
    )
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
