#!/usr/bin/env python3
"""Read-only, retry-safe bridge from Honaz SQLite to Hamin Chart CRM."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import sqlite3
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DB_PATH = os.getenv("HONAZ_DB_PATH", "/honaz/quiz.db")
QUESTIONS_PATH = os.getenv("HONAZ_QUESTIONS_PATH", "/app/integrations/honaz/questions.json")
LEGACY_QUESTIONS_PATH = os.getenv("HONAZ_LEGACY_QUESTIONS_PATH", "/app/integrations/honaz/legacy-questions.json")
STATE_PATH = Path(os.getenv("HONAZ_SYNC_STATE_PATH", "/state/honaz-sync-state.json"))
HEARTBEAT_PATH = Path(os.getenv("HONAZ_SYNC_HEARTBEAT_PATH", "/tmp/honaz-sync-heartbeat"))
CRM_URL = os.getenv("HONAZ_CRM_URL", "http://crm:8787/api/v1/events")
CRM_SOURCE = os.getenv("HONAZ_CRM_SOURCE", "honaz-test")
CRM_KEY = os.getenv("HONAZ_CRM_KEY", "")
IP_HASH_KEY = os.getenv("HONAZ_IP_HASH_KEY", "")
POLL_SECONDS = max(5, int(os.getenv("HONAZ_SYNC_INTERVAL", "20")))
FULL_RECONCILE_SECONDS = max(300, int(os.getenv("HONAZ_FULL_RECONCILE_INTERVAL", "21600")))


def load_json(path: str) -> dict[str, Any]:
    with open(path, encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, dict):
        raise ValueError(f"Expected object in {path}")
    return data


CURRENT_QUESTIONS = load_json(QUESTIONS_PATH)
LEGACY_QUESTIONS = load_json(LEGACY_QUESTIONS_PATH)


def read_state() -> dict[str, int]:
    try:
        value = json.loads(STATE_PATH.read_text(encoding="utf-8"))
        return {"submission": int(value.get("submission", 0)), "feedback": int(value.get("feedback", 0))}
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        return {"submission": 0, "feedback": 0}


def write_state(state: dict[str, int]) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    temporary = STATE_PATH.with_suffix(".tmp")
    temporary.write_text(json.dumps(state, separators=(",", ":")), encoding="utf-8")
    temporary.replace(STATE_PATH)


def parse_json(value: Any, fallback: Any) -> Any:
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value or "")
    except (TypeError, ValueError, json.JSONDecodeError):
        return fallback


def iso_timestamp(row: sqlite3.Row) -> str:
    raw = row["timestamp"] if "timestamp" in row.keys() else None
    if isinstance(raw, (int, float)) and raw > 0:
        seconds = raw / 1000 if raw > 10_000_000_000 else raw
        return datetime.fromtimestamp(seconds, timezone.utc).isoformat().replace("+00:00", "Z")
    created = str(row["created_at"] or "").strip() if "created_at" in row.keys() else ""
    if created:
        parsed = datetime.fromisoformat(created.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def pseudonym(ip: Any) -> str:
    value = str(ip or "unknown").strip()
    return hmac.new(IP_HASH_KEY.encode(), value.encode(), hashlib.sha256).hexdigest()


def gender_value(value: Any) -> str:
    return {"boy": "male", "girl": "female", "male": "male", "female": "female"}.get(str(value).lower(), str(value or "other"))


def phone_from(value: Any) -> str | None:
    match = re.search(r"(?<!\d)(?:\+98|0098|0)?9\d{9}(?!\d)", str(value or "").replace(" ", "").replace("-", ""))
    return match.group(0) if match else None


def question_map(gender: str) -> dict[str, dict[str, Any]]:
    questions = CURRENT_QUESTIONS.get(gender, [])
    return {str(item.get("id")): item for item in questions if isinstance(item, dict)}


def answers_for(row: sqlite3.Row) -> tuple[list[dict[str, Any]], str]:
    values = parse_json(row["answers_json"], {})
    if not isinstance(values, dict):
        return [], "unknown"
    gender = str(row["gender"] or "")
    is_legacy = bool(values) and all(str(key).isdigit() for key in values)
    result: list[dict[str, Any]] = []
    if is_legacy:
        texts = LEGACY_QUESTIONS.get(gender, [])
        for key, value in sorted(values.items(), key=lambda item: int(str(item[0]))):
            index = int(str(key)) - 1
            text = texts[index] if 0 <= index < len(texts) else f"سؤال نسخه قدیمی {key}"
            result.append({"questionKey": f"legacy-{gender}-{key}", "questionText": text, "value": value, "label": str(value)})
        return result, "legacy-15"
    definitions = question_map(gender)
    for key, value in values.items():
        definition = definitions.get(str(key), {})
        options = definition.get("options", {}) if isinstance(definition, dict) else {}
        label = options.get(str(value), str(value)) if isinstance(options, dict) else str(value)
        result.append({
            "questionKey": str(key),
            "questionText": definition.get("text", f"سؤال {key}") if isinstance(definition, dict) else f"سؤال {key}",
            "value": value,
            "label": label,
        })
    return result, "current-12"


def dimensions_for(row: sqlite3.Row) -> tuple[dict[str, float], dict[str, Any], dict[str, Any]]:
    dimensions = parse_json(row["dimensions_json"], [])
    scores: dict[str, float] = {}
    levels: dict[str, Any] = {}
    details: dict[str, Any] = {}
    if not isinstance(dimensions, list):
        return scores, levels, details
    for index, item in enumerate(dimensions, 1):
        if not isinstance(item, dict):
            continue
        key = str(item.get("id") or item.get("key") or f"dimension_{index}")
        score = item.get("score")
        if isinstance(score, (int, float)) and not isinstance(score, bool):
            scores[key] = float(score)
        if item.get("level") not in (None, ""):
            levels[key] = item["level"]
        details[key] = {field: item[field] for field in ("label", "level", "description") if item.get(field) not in (None, "")}
    return scores, levels, details


def submission_event(row: sqlite3.Row) -> dict[str, Any]:
    answers, schema_version = answers_for(row)
    scores, levels, details = dimensions_for(row)
    contact = str(row["contact_info"] or "").strip()
    notes = str(row["user_notes"] or "").strip()
    profile: dict[str, Any] = {
        "ipHash": pseudonym(row["client_ip"]),
        "gender": gender_value(row["gender"]),
        "metadata": {
            "sourceSubmissionId": row["id"],
            "sourceCreatedAt": row["created_at"],
            "userAgent": row["user_agent"],
            "contactInfo": contact or None,
            "userNotes": notes or None,
        },
    }
    phone = phone_from(contact)
    if phone:
        profile["phone"] = phone
    archetype_id = str(row["archetype_id"] or "").strip()
    archetype_title = str(row["archetype_title"] or "").strip()
    overall = round(sum(scores.values()) / len(scores), 2) if scores else None
    result = {
        "overall": overall,
        "archetypeId": archetype_id or None,
        "archetypeTitle": archetype_title or None,
        "levels": levels,
        "dimensionDetails": details,
        "schemaVersion": schema_version,
        "contactInfo": contact or None,
        "userNotes": notes or None,
    }
    return {
        "eventId": f"honaz-submission-{row['id']}",
        "type": "test.completed",
        "occurredAt": iso_timestamp(row),
        "payload": {
            "attemptId": f"honaz-{row['id']}",
            "testKey": "honaz-test",
            "trackingCode": f"HONAZ-{row['id']}",
            "profile": profile,
            "answers": answers,
            "scores": scores,
            "result": result,
        },
    }


def feedback_event(row: sqlite3.Row) -> dict[str, Any]:
    payload = {key: row[key] for key in row.keys() if key not in {"client_ip", "timestamp", "created_at"}}
    payload["ipHash"] = pseudonym(row["client_ip"] if "client_ip" in row.keys() else None)
    return {
        "eventId": f"honaz-feedback-{row['id']}",
        "type": "test.feedback.created",
        "occurredAt": iso_timestamp(row),
        "payload": payload,
    }


def send(events: list[dict[str, Any]]) -> None:
    if not events:
        return
    body = json.dumps({"events": events}, ensure_ascii=False, separators=(",", ":")).encode()
    request = urllib.request.Request(CRM_URL, body, {
        "Content-Type": "application/json",
        "X-CRM-Source": CRM_SOURCE,
        "X-CRM-Key": CRM_KEY,
    }, method="POST")
    with urllib.request.urlopen(request, timeout=30) as response:
        if response.status != 202:
            raise RuntimeError(f"CRM returned HTTP {response.status}")
        result = json.loads(response.read().decode())
        if result.get("accepted") != len(events):
            raise RuntimeError("CRM did not accept every event")


def rows_after(db: sqlite3.Connection, table: str, last_id: int) -> list[sqlite3.Row]:
    return list(db.execute(f'SELECT * FROM "{table}" WHERE id > ? ORDER BY id LIMIT 20', (last_id,)))


def synchronize(state: dict[str, int]) -> bool:
    changed = False
    connection = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True, timeout=10)
    connection.row_factory = sqlite3.Row
    try:
        for table, state_key, builder in (("submissions", "submission", submission_event), ("feedbacks", "feedback", feedback_event)):
            while True:
                rows = rows_after(connection, table, state[state_key])
                if not rows:
                    break
                send([builder(row) for row in rows])
                state[state_key] = int(rows[-1]["id"])
                write_state(state)
                changed = True
    finally:
        connection.close()
    HEARTBEAT_PATH.touch()
    return changed


def validate_configuration() -> None:
    if not CRM_KEY or len(CRM_KEY) < 24:
        raise RuntimeError("HONAZ_CRM_KEY is missing or too short")
    if not IP_HASH_KEY or len(IP_HASH_KEY) < 32:
        raise RuntimeError("HONAZ_IP_HASH_KEY is missing or too short")
    if not Path(DB_PATH).is_file():
        raise RuntimeError(f"Honaz database does not exist: {DB_PATH}")


def main() -> None:
    validate_configuration()
    state = read_state()
    last_full_reconcile = time.monotonic()
    delay = 1
    while True:
        try:
            if time.monotonic() - last_full_reconcile >= FULL_RECONCILE_SECONDS:
                state = {"submission": 0, "feedback": 0}
                last_full_reconcile = time.monotonic()
            synchronize(state)
            delay = 1
            time.sleep(POLL_SECONDS)
        except (OSError, sqlite3.Error, urllib.error.URLError, RuntimeError, ValueError) as error:
            print(f"honaz-sync retrying after error: {error}", flush=True)
            time.sleep(delay)
            delay = min(delay * 2, 60)


if __name__ == "__main__":
    main()
