#!/usr/bin/env python3
"""Import all legacy psychology-test records into the central CRM idempotently."""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path


CONFIG = {
    "psytest-1": ("psytest1", "records.json", "personality", ("e", "c", "m", "a")),
    "psytest-2": ("psytest2", "records_anxiety.json", "anxiety", ("ga", "ph", "gad", "ocd", "total")),
    "psytest-3": ("psytest3", "records_depression.json", "depression", ("body", "mind", "behavior", "total")),
}
PERSIAN_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹", "0123456789")
ARABIC_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")


def text(value: object) -> str:
    return str(value or "").strip()


def number(value: object, minimum: int | None = None, maximum: int | None = None) -> int | None:
    try:
        result = int(float(str(value).translate(PERSIAN_DIGITS).translate(ARABIC_DIGITS)))
    except (TypeError, ValueError):
        return None
    if minimum is not None and result < minimum:
        return None
    if maximum is not None and result > maximum:
        return None
    return result


def jalali_to_gregorian(jy: int, jm: int, jd: int) -> tuple[int, int, int]:
    jy += 1595
    days = -355668 + 365 * jy + (jy // 33) * 8 + ((jy % 33 + 3) // 4) + jd
    days += (jm - 1) * 31 if jm < 7 else (jm - 7) * 30 + 186
    gy = 400 * (days // 146097)
    days %= 146097
    if days > 36524:
        gy += 100 * ((days - 1) // 36524)
        days = (days - 1) % 36524
        if days >= 365:
            days += 1
    gy += 4 * (days // 1461)
    days %= 1461
    if days > 365:
        gy += (days - 1) // 365
        days = (days - 1) % 365
    gd = days + 1
    leap = gy % 4 == 0 and (gy % 100 != 0 or gy % 400 == 0)
    month_days = [31, 29 if leap else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    gm = 1
    for length in month_days:
        if gd <= length:
            break
        gd -= length
        gm += 1
    return gy, gm, gd


def timestamp(value: object, fallback: int) -> tuple[int, bool]:
    normalized = text(value).translate(PERSIAN_DIGITS).translate(ARABIC_DIGITS)
    match = re.fullmatch(r"(\d{4})/(\d{1,2})/(\d{1,2})", normalized)
    if not match:
        return fallback, True
    year, month, day = map(int, match.groups())
    try:
        gy, gm, gd = jalali_to_gregorian(year, month, day)
        return int(datetime(gy, gm, gd, 12, tzinfo=timezone.utc).timestamp()), False
    except ValueError:
        return fallback, True


def stable_id(kind: str, source: str, identity: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"hamin-crm:{kind}:{source}:{identity}"))


def load_records(path: Path) -> list[dict[str, object]]:
    value = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(value, list):
        raise ValueError(f"{path} must contain a JSON array")
    occurrences: dict[str, int] = {}
    records: list[dict[str, object]] = []
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            continue
        tracking = text(item.get("trackingCode")) or f"missing-{index + 1}"
        occurrences[tracking] = occurrences.get(tracking, 0) + 1
        copy = dict(item)
        copy["_legacyAttemptId"] = tracking if occurrences[tracking] == 1 else f"{tracking}~legacy-{occurrences[tracking]}"
        records.append(copy)
    return records


def load_depression_database(path: Path) -> list[dict[str, object]]:
    connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    try:
        rows = connection.execute("SELECT * FROM results ORDER BY id").fetchall()
    finally:
        connection.close()
    result = []
    for row in rows:
        tracking = text(row["tracking_code"]) or f"database-{row['id']}"
        result.append({
            "_legacyAttemptId": tracking,
            "trackingCode": tracking,
            "name": row["name"], "phone": row["phone"], "province": row["province"],
            "gender": row["gender"], "age": row["age"], "edu": row["education"],
            "job": row["job"], "maritalStatus": row["marital_status"], "testReason": row["test_reason"],
            "body": row["score_o"], "mind": row["score_c"], "behavior": row["score_e"], "total": row["score_n"],
            "analysis": row["analysis"], "date": row["submitted_date"] or row["created_at"], "seen": row["seen"],
        })
    return result


def resolve_contact(connection: sqlite3.Connection, source_id: str, source: str, record: dict[str, object], tracking: str, occurred: int) -> str:
    phone = text(record.get("phone"))
    anonymous = f"attempt:{tracking}"
    row = None
    if phone:
        row = connection.execute("SELECT id FROM contacts WHERE source_id=? AND phone=? ORDER BY first_seen_at LIMIT 1", (source_id, phone)).fetchone()
    if row is None:
        row = connection.execute("SELECT id FROM contacts WHERE source_id=? AND anonymous_id=? LIMIT 1", (source_id, anonymous)).fetchone()
    contact_id = row[0] if row else stable_id("contact", source, phone or anonymous)
    profile = {
        "name": text(record.get("name")),
        "phone": phone,
        "province": text(record.get("province")),
        "gender": text(record.get("gender")),
        "age": number(record.get("age"), 1, 120),
        "education": text(record.get("edu") or record.get("education")),
    }
    if row:
        connection.execute(
            """UPDATE contacts SET
              name=COALESCE(NULLIF(name,''),NULLIF(?,'')), phone=COALESCE(NULLIF(phone,''),NULLIF(?,'')),
              province=COALESCE(NULLIF(province,''),NULLIF(?,'')), gender=COALESCE(NULLIF(gender,''),NULLIF(?,'')),
              age=COALESCE(age,?), education=COALESCE(NULLIF(education,''),NULLIF(?,'')),
              first_seen_at=MIN(first_seen_at,?), last_seen_at=MAX(last_seen_at,?), updated_at=? WHERE id=?""",
            (profile["name"], phone, profile["province"], profile["gender"], profile["age"], profile["education"], occurred, occurred, int(time.time()), contact_id),
        )
    else:
        connection.execute(
            """INSERT INTO contacts
              (id,source_id,anonymous_id,name,phone,province,gender,age,education,metadata,first_seen_at,last_seen_at,created_at,updated_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (contact_id, source_id, anonymous, profile["name"] or None, phone or None, profile["province"] or None, profile["gender"] or None, profile["age"], profile["education"] or None, json.dumps({"legacyImport": True}, ensure_ascii=False), occurred, occurred, int(time.time()), int(time.time())),
        )
    return contact_id


def import_file(connection: sqlite3.Connection, source: str, directory: Path) -> dict[str, int]:
    folder, filename, test_key, score_keys = CONFIG[source]
    path = directory / folder / filename
    records = load_records(path)
    if source == "psytest-3":
        records.extend(load_depression_database(directory / folder / "results.db"))
    source_row = connection.execute("SELECT id FROM sources WHERE slug=? AND kind='test'", (source,)).fetchone()
    if not source_row:
        raise RuntimeError(f"CRM source is missing: {source}")
    source_id = source_row[0]
    fallback = int(path.stat().st_mtime)
    inserted = updated = estimated_dates = 0
    for index, record in enumerate(records):
        tracking = text(record.get("trackingCode")) or f"missing-{index + 1}"
        external_attempt = text(record.get("_legacyAttemptId")) or tracking
        occurred, estimated = timestamp(record.get("date"), fallback)
        estimated_dates += int(estimated)
        contact_id = resolve_contact(connection, source_id, source, record, tracking, occurred)
        scores = {key: value for key in score_keys if (value := number(record.get(key))) is not None}
        profile = {
            "name": text(record.get("name")), "phone": text(record.get("phone")),
            "province": text(record.get("province")), "gender": text(record.get("gender")),
            "age": number(record.get("age"), 1, 120), "education": text(record.get("edu") or record.get("education")),
            "legacyDate": text(record.get("date")) or None, "dateEstimated": estimated,
            "job": text(record.get("job")) or None,
            "maritalStatus": text(record.get("maritalStatus")) or None,
            "testReason": text(record.get("testReason")) or None,
            "legacySeen": number(record.get("seen")),
        }
        analysis = text(record.get("analysis")) or None
        attempt_id = stable_id("attempt", source, external_attempt)
        existing = connection.execute("SELECT id FROM test_attempts WHERE source_id=? AND external_attempt_id=?", (source_id, external_attempt)).fetchone()
        if existing:
            connection.execute(
                """UPDATE test_attempts SET contact_id=COALESCE(contact_id,?), tracking_code=COALESCE(NULLIF(tracking_code,''),?),
                profile=CASE WHEN profile IS NULL OR profile='{}' THEN ? ELSE profile END,
                scores=CASE WHEN scores IS NULL OR scores='{}' THEN ? ELSE scores END,
                ai_analysis=COALESCE(NULLIF(ai_analysis,''),?) WHERE id=?""",
                (contact_id, tracking, json.dumps(profile, ensure_ascii=False), json.dumps(scores, ensure_ascii=False), analysis, existing[0]),
            )
            updated += 1
        else:
            connection.execute(
                """INSERT INTO test_attempts
                (id,source_id,contact_id,external_attempt_id,test_key,tracking_code,profile,scores,result,ai_analysis,completed_at,created_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
                (attempt_id, source_id, contact_id, external_attempt, test_key, tracking, json.dumps(profile, ensure_ascii=False), json.dumps(scores, ensure_ascii=False), json.dumps({"legacyImport": True, "answersAvailable": False}, ensure_ascii=False), analysis, occurred, int(time.time())),
            )
            inserted += 1
    return {"read": len(records), "inserted": inserted, "updated": updated, "estimatedDates": estimated_dates}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", required=True)
    parser.add_argument("--input", required=True, type=Path)
    args = parser.parse_args()
    connection = sqlite3.connect(args.database, timeout=60)
    connection.execute("PRAGMA foreign_keys=ON")
    try:
        connection.execute("BEGIN IMMEDIATE")
        summary = {source: import_file(connection, source, args.input) for source in CONFIG}
        connection.commit()
        integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
        if integrity != "ok":
            raise RuntimeError(f"integrity_check: {integrity}")
        print(json.dumps(summary, ensure_ascii=False))
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


if __name__ == "__main__":
    main()
