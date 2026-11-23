"""Release obsolete corpus copies while preserving immutable scopes in use."""

import math

from .storage import now

UNPINNED_SNAPSHOT = """
    NOT EXISTS (
        SELECT 1 FROM metadata active
        WHERE active.key='active_snapshot' AND active.value=snapshot.id
    )
    AND NOT EXISTS (
        SELECT 1 FROM runs job
        WHERE job.snapshot_id=snapshot.id AND job.status IN ('queued','running')
    )
"""


def cleanup_snapshots(db, max_age_seconds=3600):
    """Prune unpinned committed text and expired staging snapshots atomically.

    Committed snapshot metadata remains available for saved reports. The age
    threshold applies to preparing snapshots, so an interrupted upload has time
    to resume. Sync and run creation must use the same advisory lock when pinning
    a snapshot on PostgreSQL. Database.connect(write=True) provides the matching
    SQLite write transaction.
    """
    if (
        isinstance(max_age_seconds, bool)
        or not isinstance(max_age_seconds, (int, float))
        or not math.isfinite(max_age_seconds)
        or max_age_seconds < 0
    ):
        raise ValueError("max_age_seconds must be a finite nonnegative number.")

    cutoff = now() - max_age_seconds
    expired_preparing = f"""
        SELECT snapshot.id FROM snapshots snapshot
        WHERE snapshot.status='preparing' AND snapshot.started_at<=?
          AND {UNPINNED_SNAPSHOT}
    """
    with db.connect(write=True) as connection:
        if db.postgres:
            connection.execute("SELECT pg_advisory_xact_lock(7284511)")

        pruned_records = connection.execute(
            f"""
            DELETE FROM records WHERE snapshot_id IN (
                SELECT snapshot.id FROM snapshots snapshot
                WHERE snapshot.status='committed' AND {UNPINNED_SNAPSHOT}
            )
            """
        ).rowcount
        preparing_records = connection.execute(
            f"DELETE FROM records WHERE snapshot_id IN ({expired_preparing})",
            (cutoff,),
        ).rowcount
        preparing_snapshots = connection.execute(
            f"DELETE FROM snapshots WHERE id IN ({expired_preparing})",
            (cutoff,),
        ).rowcount

    return {
        "prunedRecords": pruned_records,
        "removedPreparingRecords": preparing_records,
        "removedPreparingSnapshots": preparing_snapshots,
    }
