"""Run the synthetic analytics suite on isolated PostgreSQL schemas.

Set ANALYTICS_TEST_POSTGRES_URL to a disposable *local* PostgreSQL database.
Every Database instance receives a new private schema, removed on completion.
No model API calls or production database access are performed.
"""

import argparse
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import parse_qsl, quote, urlencode, urlsplit, urlunsplit
from uuid import uuid4

import psycopg
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from analytics.storage import Database


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--pattern",
        action="append",
        help="Limit discovery to a test filename pattern; repeat for multiple modules.",
    )
    arguments = parser.parse_args()
    url = os.environ.get("ANALYTICS_TEST_POSTGRES_URL", "")
    if not url:
        raise SystemExit("Set ANALYTICS_TEST_POSTGRES_URL to a local test database.")
    if not url.startswith(("postgres://", "postgresql://")):
        raise SystemExit("ANALYTICS_TEST_POSTGRES_URL must be a PostgreSQL URL.")
    options = conninfo_to_dict(url)
    if options.get("host") not in ("127.0.0.1", "localhost", "::1"):
        raise SystemExit(
            "PostgreSQL acceptance tests require an explicit loopback host."
        )
    if options.get("hostaddr") and options["hostaddr"] not in ("127.0.0.1", "::1"):
        raise SystemExit("PostgreSQL acceptance tests require a loopback host address.")

    schemas = []
    urls = {}
    original_init = Database.__init__
    # Fail before discovering/running tests when the disposable database is unavailable.
    with psycopg.connect(url, connect_timeout=10) as connection:
        connection.execute("SELECT 1")

    def isolated_database(instance, _requested_url):
        if _requested_url in urls:
            original_init(instance, urls[_requested_url])
            assert instance.postgres
            return
        name = "analysis_qa_" + uuid4().hex
        with psycopg.connect(url) as connection:
            connection.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(name)))
        schemas.append(name)
        parsed = urlsplit(url)
        query = dict(parse_qsl(parsed.query))
        query["options"] = f"-c search_path={name},public"
        isolated_url = urlunsplit(
            parsed._replace(query=urlencode(query, quote_via=quote))
        )
        urls[_requested_url] = isolated_url
        urls[isolated_url] = isolated_url
        original_init(instance, isolated_url)
        assert instance.postgres, "Acceptance suite must use PostgreSQL connections."

    result = None
    try:
        with patch.object(Database, "__init__", isolated_database):
            suite = unittest.TestSuite()
            for pattern in arguments.pattern or ["test*.py"]:
                suite.addTests(
                    unittest.defaultTestLoader.discover(
                        str(ROOT / "analytics/tests"), pattern=pattern
                    )
                )
            result = unittest.TextTestRunner(verbosity=2).run(suite)
    finally:
        # Names are generated here and quoted as SQL identifiers. Existing
        # database schemas, tables and extensions are never removed.
        with psycopg.connect(url) as connection:
            for name in schemas:
                connection.execute(
                    sql.SQL("DROP SCHEMA IF EXISTS {} CASCADE").format(
                        sql.Identifier(name)
                    )
                )
    return 0 if result and result.wasSuccessful() else 1


if __name__ == "__main__":
    raise SystemExit(main())
