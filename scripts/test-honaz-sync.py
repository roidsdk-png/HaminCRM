#!/usr/bin/env python3
"""Unit checks for Honaz event conversion without touching production."""

import importlib.util
import json
import os
import sqlite3
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
os.environ.setdefault("HONAZ_QUESTIONS_PATH", str(ROOT / "integrations/honaz/questions.json"))
os.environ.setdefault("HONAZ_LEGACY_QUESTIONS_PATH", str(ROOT / "integrations/honaz/legacy-questions.json"))
os.environ.setdefault("HONAZ_IP_HASH_KEY", "test-only-secret-that-is-long-enough")
spec = importlib.util.spec_from_file_location("honaz_sync", ROOT / "scripts/honaz-sync.py")
module = importlib.util.module_from_spec(spec)
assert spec.loader
spec.loader.exec_module(module)


def row(**values):
    db = sqlite3.connect(":memory:")
    db.row_factory = sqlite3.Row
    columns = ",".join(f"? AS {key}" for key in values)
    return db.execute(f"SELECT {columns}", tuple(values.values())).fetchone()


base = dict(id=7, client_ip="192.0.2.9", user_agent="test", gender="boy", archetype_id="a1",
            archetype_title="نمونه", user_notes="", contact_info="09123456789",
            created_at="2026-09-21T10:00:00Z", timestamp=1789984800000)
current = row(**base, answers_json=json.dumps({"b1": "c"}), dimensions_json=json.dumps([
    {"id": "emotional", "label": "بلوغ هیجانی", "score": 83, "level": "بالا"}
]))
event = module.submission_event(current)
assert event["payload"]["testKey"] == "honaz-test"
assert event["payload"]["profile"]["gender"] == "male"
assert event["payload"]["profile"]["phone"] == "09123456789"
assert event["payload"]["answers"][0]["questionText"].startswith("وقتی می‌گویی")
assert event["payload"]["answers"][0]["label"].startswith("آدم بی‌نقص")
assert "192.0.2.9" not in json.dumps(event, ensure_ascii=False)

legacy = row(**{**base, "id": 8, "gender": "girl"}, answers_json=json.dumps({str(i): f"choice-{i}" for i in range(1, 16)}),
             dimensions_json=json.dumps([{"key": "identity", "label": "هویت", "score": 72}]))
old_event = module.submission_event(legacy)
assert len(old_event["payload"]["answers"]) == 15
assert old_event["payload"]["result"]["schemaVersion"] == "legacy-15"
assert old_event["payload"]["answers"][14]["questionText"].startswith("چه دستاوردی")
print("honaz-sync tests passed")
