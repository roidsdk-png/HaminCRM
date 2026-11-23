import contextlib
import json
import sqlite3
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

SCHEMA = """
CREATE TABLE IF NOT EXISTS snapshots (
    id TEXT PRIMARY KEY, generation TEXT NOT NULL, sequence BIGINT NOT NULL,
    mode TEXT NOT NULL, status TEXT NOT NULL, sources TEXT NOT NULL,
    started_at DOUBLE PRECISION NOT NULL, finished_at DOUBLE PRECISION
);
CREATE TABLE IF NOT EXISTS records (
    snapshot_id TEXT NOT NULL, id TEXT NOT NULL, kind TEXT NOT NULL,
    source_id TEXT NOT NULL, contact_id TEXT, conversation_id TEXT, role TEXT,
    occurred_at BIGINT NOT NULL, text TEXT NOT NULL, metadata TEXT NOT NULL,
    content_hash TEXT NOT NULL, PRIMARY KEY(snapshot_id,id)
);
CREATE INDEX IF NOT EXISTS idx_records_snapshot ON records(snapshot_id,kind,source_id,occurred_at);
CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY, owner TEXT NOT NULL, title TEXT NOT NULL,
    filters TEXT NOT NULL, created_at DOUBLE PRECISION NOT NULL, updated_at DOUBLE PRECISION NOT NULL
);
CREATE TABLE IF NOT EXISTS session_messages (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL,
    content TEXT NOT NULL, run_id TEXT, created_at DOUBLE PRECISION NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY, owner TEXT NOT NULL, kind TEXT NOT NULL,
    request TEXT NOT NULL, snapshot_id TEXT, status TEXT NOT NULL,
    progress INTEGER NOT NULL DEFAULT 0, processed INTEGER NOT NULL DEFAULT 0,
    eligible INTEGER NOT NULL DEFAULT 0, error TEXT, result TEXT,
    result_set_id TEXT, session_id TEXT, cancelled INTEGER NOT NULL DEFAULT 0,
    lease_until DOUBLE PRECISION, attempts INTEGER NOT NULL DEFAULT 0,
    created_at DOUBLE PRECISION NOT NULL, updated_at DOUBLE PRECISION NOT NULL, request_key TEXT,
    UNIQUE(owner,request_key)
);
CREATE INDEX IF NOT EXISTS idx_runs_queue ON runs(status,created_at);
CREATE INDEX IF NOT EXISTS idx_runs_snapshot ON runs(snapshot_id,status);
CREATE INDEX IF NOT EXISTS idx_snapshots_status ON snapshots(status,started_at);
CREATE TABLE IF NOT EXISTS run_records (
    run_id TEXT NOT NULL, record_id TEXT NOT NULL, record_hash TEXT NOT NULL,
    PRIMARY KEY(run_id,record_id)
);
CREATE TABLE IF NOT EXISTS evidence (
    id TEXT PRIMARY KEY, owner TEXT NOT NULL, run_id TEXT NOT NULL,
    record_id TEXT NOT NULL, record_hash TEXT NOT NULL,
    snapshot_id TEXT NOT NULL, data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_evidence_run ON evidence(run_id);
CREATE TABLE IF NOT EXISTS result_sets (
    id TEXT PRIMARY KEY, owner TEXT NOT NULL, run_id TEXT NOT NULL,
    items TEXT NOT NULL, created_at DOUBLE PRECISION NOT NULL
);
CREATE TABLE IF NOT EXISTS embeddings (
    cache_key TEXT PRIMARY KEY, model TEXT NOT NULL, vector_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS usage (
    id TEXT PRIMARY KEY, month TEXT NOT NULL, run_id TEXT,
    model TEXT NOT NULL, input_tokens INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL, created_at DOUBLE PRECISION NOT NULL
);
"""


def dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def loads(value: str | None, default=None):
    return json.loads(value) if value else default


class Database:
    def __init__(self, url: str):
        self.postgres = url.startswith(("postgres://", "postgresql://"))
        self.url = url
        self.path = None
        if not self.postgres:
            self.path = url.removeprefix("sqlite:///")
            if self.path == ":memory:":
                raise ValueError(
                    "Use a temporary SQLite file so worker connections share state."
                )
            Path(self.path).resolve().parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as connection:
            for statement in SCHEMA.split(";"):
                if statement.strip():
                    connection.execute(statement)
            if self.postgres:
                # PostgreSQL REAL stores only 24 significant bits, losing
                # minute-scale precision for epoch timestamps. Upgrade only
                # the known analytics columns in this database's own schema.
                for table, columns in {
                    "snapshots": ("started_at", "finished_at"),
                    "sessions": ("created_at", "updated_at"),
                    "session_messages": ("created_at",),
                    "runs": ("lease_until", "created_at", "updated_at"),
                    "result_sets": ("created_at",),
                    "usage": ("created_at",),
                }.items():
                    for column in columns:
                        existing = connection.one(
                            "SELECT data_type FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=? AND column_name=?",
                            (table, column),
                        )
                        if existing and existing["data_type"] == "real":
                            connection.execute(
                                f"ALTER TABLE {table} ALTER COLUMN {column} TYPE DOUBLE PRECISION"
                            )
        self.vector_available = False
        if self.postgres:
            import psycopg

            try:
                with self.connect() as connection:
                    connection.execute("CREATE EXTENSION IF NOT EXISTS vector")
                    connection.execute(
                        "ALTER TABLE embeddings ADD COLUMN IF NOT EXISTS vector_value vector"
                    )
                self.vector_available = True
            except psycopg.Error:
                # Exact vector similarity remains available over JSON vectors.
                self.vector_available = False

    @contextlib.contextmanager
    def connect(self, write: bool = False):
        if self.postgres:
            import psycopg
            from psycopg.rows import dict_row

            connection = psycopg.connect(
                self.url, row_factory=dict_row, connect_timeout=10
            )
        else:
            connection = sqlite3.connect(self.path, timeout=30)
            connection.row_factory = sqlite3.Row
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute("PRAGMA busy_timeout=30000")
            if write:
                connection.execute("BEGIN IMMEDIATE")
        wrapper = Connection(connection, self.postgres)
        try:
            yield wrapper
            connection.commit()
        except BaseException:
            connection.rollback()
            raise
        finally:
            connection.close()

    def one(self, sql: str, params=()):
        with self.connect() as connection:
            return connection.one(sql, params)

    def all(self, sql: str, params=()):
        with self.connect() as connection:
            return connection.all(sql, params)

    def execute(self, sql: str, params=()):
        with self.connect(write=True) as connection:
            return connection.execute(sql, params).rowcount

    def active_snapshot(self):
        return self.one(
            "SELECT s.* FROM snapshots s JOIN metadata m ON m.value=s.id WHERE m.key='active_snapshot'"
        )


class Connection:
    def __init__(self, connection, postgres):
        self.connection = connection
        self.postgres = postgres

    def execute(self, sql: str, params=()):
        return self.connection.execute(
            sql.replace("?", "%s") if self.postgres else sql, params
        )

    def executemany(self, sql: str, params):
        statement = sql.replace("?", "%s") if self.postgres else sql
        cursor = self.connection.cursor()
        try:
            cursor.executemany(statement, params)
        finally:
            cursor.close()

    def one(self, sql: str, params=()):
        row = self.execute(sql, params).fetchone()
        return dict(row) if row is not None else None

    def all(self, sql: str, params=()):
        return [dict(row) for row in self.execute(sql, params).fetchall()]


class AnalyticsError(Exception):
    def __init__(self, code: str, message: str, status: int = 400):
        self.code = code
        self.message = message
        self.status = status
        super().__init__(message)


def now():
    return time.time()


def iso(value):
    return (
        datetime.fromtimestamp(value, UTC).isoformat().replace("+00:00", "Z")
        if value is not None
        else None
    )
