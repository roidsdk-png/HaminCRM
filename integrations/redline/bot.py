"""ربات آزمون شناخت پیش از ازدواج برای پیام‌رسان بله.

این برنامه از Bot API بله با long polling استفاده می‌کند و برای اجرا به
هیچ کتابخانهٔ شخص ثالثی نیاز ندارد. کلید از متغیر محیطی یا فایل API Key.txt
خوانده می‌شود و هرگز در لاگ چاپ نمی‌شود.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import signal
import sqlite3
import threading
import time
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any, Iterable
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from crm_reporter import RedlineCrmReporter


ROOT = Path(__file__).resolve().parent
PERSIAN_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹", "0123456789")
OPTION_KEYS = ("الف", "ب", "ج", "د")


def read_settings() -> dict[str, str]:
    """Read simple KEY=VALUE settings without requiring python-dotenv."""
    values: dict[str, str] = {
        "BALE_API_BASE": "https://tapi.bale.ai/bot",
        "BALE_TOKEN_FILE": str(ROOT / "API Key.txt"),
        "HEALTH_HOST": "127.0.0.1",
        "HEALTH_PORT": "18115",
        "STATE_DB": str(ROOT / "bot_state.sqlite3"),
        "POLL_TIMEOUT": "25",
        "CRM_URL": "",
        "CRM_SOURCE": "redline-test",
        "CRM_API_KEY": "",
        "CRM_OUTBOX_DIR": str(ROOT / "crm-outbox"),
        "CRM_TELEGRAM_SOURCE": "redline-telegram",
        "CRM_TELEGRAM_API_KEY": "",
    }
    env_file = Path(os.environ.get("BALE_ENV_FILE", ROOT / ".env"))
    if env_file.exists():
        for raw in env_file.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip().strip('"').strip("'")
    values.update(
        {
            k: v
            for k, v in os.environ.items()
            if k in values or k == "BALE_TOKEN"
        }
    )
    return values


def read_token(settings: dict[str, str]) -> str:
    token = settings.get("BALE_TOKEN", "").strip()
    if token:
        return token
    token_file = Path(settings.get("BALE_TOKEN_FILE", ROOT / "API Key.txt"))
    if not token_file.is_absolute():
        token_file = ROOT / token_file
    if not token_file.exists():
        raise RuntimeError(
            "کلید پیدا نشد. BALE_TOKEN را تنظیم کنید یا مسیر BALE_TOKEN_FILE را به فایل کلید بدهید."
        )
    text = token_file.read_text(encoding="utf-8-sig")
    match = re.search(r"\b\d{6,}:[A-Za-z0-9_-]{20,}\b", text)
    if not match:
        raise RuntimeError("در فایل کلید، توکن معتبر بله پیدا نشد.")
    return match.group(0)


class BaleAPIError(RuntimeError):
    pass


class HealthHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802 - stdlib handler API
        if self.path not in {"/", "/health"}:
            self.send_response(404)
            self.end_headers()
            return
        payload = b'{"ok":true,"service":"redline-bot"}\n'
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *_: Any) -> None:
        return


def start_health_server(host: str, port: int) -> HTTPServer | None:
    if port <= 0:
        return None
    server = HTTPServer((host, port), HealthHandler)
    thread = threading.Thread(target=server.serve_forever, name="redline-health", daemon=True)
    thread.start()
    return server


class BaleAPI:
    def __init__(self, token: str, base_url: str = "https://tapi.bale.ai/bot") -> None:
        # Bale's endpoint is /bot<token>/METHOD_NAME (there is no slash
        # between the literal ``bot`` prefix and the token).
        self.base_url = base_url.rstrip("/") + token

    def call(self, method: str, payload: dict[str, Any] | None = None, timeout: int = 30) -> Any:
        url = f"{self.base_url}/{method}"
        body = json.dumps(payload or {}, ensure_ascii=False).encode("utf-8")
        request = Request(
            url,
            data=body,
            headers={"Content-Type": "application/json; charset=utf-8"},
            method="POST",
        )
        try:
            with urlopen(request, timeout=timeout) as response:
                raw = response.read().decode("utf-8")
        except HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:300]
            raise BaleAPIError(f"Bale API HTTP {exc.code}: {detail}") from exc
        except (URLError, TimeoutError, OSError) as exc:
            raise BaleAPIError(f"ارتباط با API بله برقرار نشد: {exc}") from exc
        try:
            result = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise BaleAPIError("پاسخ API بله JSON معتبر نبود.") from exc
        if not result.get("ok"):
            raise BaleAPIError(result.get("description", "درخواست API بله ناموفق بود."))
        return result.get("result")

    def get_me(self) -> dict[str, Any]:
        return self.call("getMe")

    def get_updates(self, offset: int | None, poll_timeout: int) -> list[dict[str, Any]]:
        payload: dict[str, Any] = {"timeout": poll_timeout}
        if offset is not None:
            payload["offset"] = offset
        return self.call("getUpdates", payload, timeout=poll_timeout + 10) or []

    def send_message(
        self, chat_id: int, text: str, reply_markup: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {"chat_id": chat_id, "text": text}
        if reply_markup:
            payload["reply_markup"] = reply_markup
        return self.call("sendMessage", payload)

    def delete_message(self, chat_id: int, message_id: int) -> bool:
        return bool(self.call("deleteMessage", {"chat_id": chat_id, "message_id": message_id}))

    def answer_callback(self, callback_id: str, text: str | None = None) -> bool:
        payload: dict[str, Any] = {"callback_query_id": callback_id}
        if text:
            payload["text"] = text
        return bool(self.call("answerCallbackQuery", payload))


class SessionStore:
    def __init__(self, path: str) -> None:
        self.connection = sqlite3.connect(path)
        self.connection.row_factory = sqlite3.Row
        self.connection.execute("PRAGMA foreign_keys = ON")
        self.connection.execute(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                chat_id INTEGER PRIMARY KEY,
                gender TEXT,
                question_index INTEGER NOT NULL DEFAULT 0,
                answers TEXT NOT NULL DEFAULT '{}',
                last_message_id INTEGER,
                updated_at REAL NOT NULL
            )
            """
        )
        columns = {
            row["name"] for row in self.connection.execute("PRAGMA table_info(sessions)").fetchall()
        }
        if "attempt_id" not in columns:
            self.connection.execute("ALTER TABLE sessions ADD COLUMN attempt_id INTEGER")
        self.connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS participants (
                chat_id INTEGER PRIMARY KEY,
                first_seen_at REAL NOT NULL,
                last_seen_at REAL NOT NULL,
                last_gender TEXT,
                completed_attempts INTEGER NOT NULL DEFAULT 0,
                first_name TEXT,
                last_name TEXT,
                username TEXT
            );
            CREATE TABLE IF NOT EXISTS attempts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_id INTEGER NOT NULL,
                gender TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'in_progress',
                started_at REAL NOT NULL,
                completed_at REAL,
                questions_total INTEGER NOT NULL DEFAULT 20,
                good_count INTEGER,
                improve_count INTEGER,
                consult_count INTEGER,
                good_percent REAL,
                improve_percent REAL,
                consult_percent REAL,
                report_text TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_attempts_chat_id ON attempts(chat_id);
            CREATE INDEX IF NOT EXISTS idx_attempts_gender_status ON attempts(gender, status);
            CREATE TABLE IF NOT EXISTS attempt_answers (
                attempt_id INTEGER NOT NULL,
                question_id INTEGER NOT NULL,
                option_key TEXT NOT NULL,
                category TEXT NOT NULL,
                points INTEGER NOT NULL,
                indicator TEXT NOT NULL,
                PRIMARY KEY(attempt_id, question_id),
                FOREIGN KEY(attempt_id) REFERENCES attempts(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_attempt_answers_indicator ON attempt_answers(indicator);
            """
        )
        participant_columns = {
            row["name"]
            for row in self.connection.execute("PRAGMA table_info(participants)").fetchall()
        }
        for name in ("first_name", "last_name", "username"):
            if name not in participant_columns:
                self.connection.execute(f"ALTER TABLE participants ADD COLUMN {name} TEXT")
        self.connection.commit()

    def save_identity(self, chat_id: int, sender: dict[str, Any]) -> None:
        now = time.time()
        self.connection.execute(
            "INSERT INTO participants(chat_id, first_seen_at, last_seen_at, first_name, last_name, username) "
            "VALUES(?, ?, ?, ?, ?, ?) ON CONFLICT(chat_id) DO UPDATE SET "
            "last_seen_at=excluded.last_seen_at, "
            "first_name=COALESCE(NULLIF(excluded.first_name,''),participants.first_name), "
            "last_name=COALESCE(NULLIF(excluded.last_name,''),participants.last_name), "
            "username=COALESCE(NULLIF(excluded.username,''),participants.username)",
            (
                chat_id,
                now,
                now,
                str(sender.get("first_name") or "").strip(),
                str(sender.get("last_name") or "").strip(),
                str(sender.get("username") or "").strip(),
            ),
        )
        self.connection.commit()

    def participant(self, chat_id: int) -> dict[str, Any]:
        row = self.connection.execute(
            "SELECT first_name, last_name, username FROM participants WHERE chat_id=?",
            (chat_id,),
        ).fetchone()
        if not row:
            return {}
        return {
            "firstName": row["first_name"],
            "lastName": row["last_name"],
            "username": row["username"],
        }

    def reset(self, chat_id: int) -> None:
        self.connection.execute(
            "INSERT INTO sessions(chat_id, updated_at) VALUES(?, ?) "
            "ON CONFLICT(chat_id) DO UPDATE SET gender=NULL, question_index=0, answers='{}', "
            "last_message_id=NULL, attempt_id=NULL, updated_at=excluded.updated_at",
            (chat_id, time.time()),
        )
        self.connection.commit()

    def get(self, chat_id: int) -> sqlite3.Row | None:
        return self.connection.execute("SELECT * FROM sessions WHERE chat_id=?", (chat_id,)).fetchone()

    def save_gender(self, chat_id: int, gender: str) -> int:
        now = time.time()
        self.connection.execute(
            "INSERT INTO participants(chat_id, first_seen_at, last_seen_at, last_gender) VALUES(?, ?, ?, ?) "
            "ON CONFLICT(chat_id) DO UPDATE SET last_seen_at=excluded.last_seen_at, last_gender=excluded.last_gender",
            (chat_id, now, now, gender),
        )
        self.connection.execute(
            "UPDATE attempts SET status='abandoned', completed_at=? WHERE chat_id=? AND status='in_progress'",
            (now, chat_id),
        )
        cursor = self.connection.execute(
            "INSERT INTO attempts(chat_id, gender, started_at) VALUES(?, ?, ?)",
            (chat_id, gender, now),
        )
        attempt_id = int(cursor.lastrowid)
        self.connection.execute(
            "UPDATE sessions SET gender=?, question_index=0, answers='{}', attempt_id=?, updated_at=? WHERE chat_id=?",
            (gender, attempt_id, now, chat_id),
        )
        self.connection.commit()
        return attempt_id

    def save_answer(self, chat_id: int, question_id: int, key: str) -> None:
        row = self.get(chat_id)
        answers = json.loads(row["answers"] if row else "{}")
        answers[str(question_id)] = key
        self.connection.execute(
            "UPDATE sessions SET answers=?, question_index=question_index+1, updated_at=? WHERE chat_id=?",
            (json.dumps(answers, ensure_ascii=False), time.time(), chat_id),
        )
        self.connection.commit()

    def set_last_message(self, chat_id: int, message_id: int | None) -> None:
        self.connection.execute(
            "UPDATE sessions SET last_message_id=?, updated_at=? WHERE chat_id=?",
            (message_id, time.time(), chat_id),
        )
        self.connection.commit()

    def answers(self, chat_id: int) -> dict[str, str]:
        row = self.get(chat_id)
        return json.loads(row["answers"] if row else "{}")

    def complete_attempt(
        self,
        chat_id: int,
        gender: str,
        questions: list[dict[str, Any]],
        answers: dict[str, str],
        report_text: str,
    ) -> dict[str, Any]:
        row = self.get(chat_id)
        attempt_id = int(row["attempt_id"]) if row and row["attempt_id"] else None
        if attempt_id is None:
            self.save_gender(chat_id, gender)
            row = self.get(chat_id)
            attempt_id = int(row["attempt_id"])
        score = score_answers(questions, answers)
        overall = score["overall"]
        percentages = score["percentages"]
        now = time.time()
        self.connection.execute(
            "UPDATE attempts SET status='completed', completed_at=?, questions_total=?, good_count=?, improve_count=?, consult_count=?, "
            "good_percent=?, improve_percent=?, consult_percent=?, report_text=? WHERE id=?",
            (
                now,
                len(questions),
                overall["good"],
                overall["improve"],
                overall["consult"],
                percentages["good"],
                percentages["improve"],
                percentages["consult"],
                report_text,
                attempt_id,
            ),
        )
        self.connection.executemany(
            "INSERT OR REPLACE INTO attempt_answers(attempt_id, question_id, option_key, category, points, indicator) VALUES(?, ?, ?, ?, ?, ?)",
            [
                (
                    attempt_id,
                    question["id"],
                    answers.get(str(question["id"]), "د"),
                    (category := classify_answer(question, answers.get(str(question["id"])) ))[0],
                    category[1],
                    INDICATOR_BY_ID.get(question["id"], "lifestyle"),
                )
                for question in questions
            ],
        )
        self.connection.execute(
            "UPDATE participants SET last_seen_at=?, last_gender=?, completed_attempts=completed_attempts+1 WHERE chat_id=?",
            (now, gender, chat_id),
        )
        self.connection.commit()
        saved = self.connection.execute(
            "SELECT chat_id, gender, started_at, completed_at, good_count, improve_count, consult_count, "
            "good_percent, improve_percent, consult_percent, report_text FROM attempts WHERE id=?",
            (attempt_id,),
        ).fetchone()
        return {
            "attemptId": attempt_id,
            "chatId": saved["chat_id"],
            "gender": saved["gender"],
            "startedAt": saved["started_at"],
            "completedAt": saved["completed_at"],
            "scores": {
                "goodPercent": saved["good_percent"],
                "improvePercent": saved["improve_percent"],
                "consultPercent": saved["consult_percent"],
            },
            "result": {
                "goodCount": saved["good_count"],
                "improveCount": saved["improve_count"],
                "consultCount": saved["consult_count"],
                "indicators": score["indicators"],
                "groupedIndicators": score["grouped_indicators"],
            },
            "indicatorsByQuestion": {
                str(question["id"]): INDICATOR_BY_ID.get(question["id"], "lifestyle")
                for question in questions
            },
            "reportText": saved["report_text"],
        }

    def get_stats(self) -> dict[str, Any]:
        def rows_to_dict(rows: list[sqlite3.Row]) -> list[dict[str, Any]]:
            return [dict(row) for row in rows]

        participant_rows = rows_to_dict(
            self.connection.execute(
                "SELECT COALESCE(last_gender, 'unknown') AS gender, COUNT(*) AS participants "
                "FROM participants GROUP BY COALESCE(last_gender, 'unknown') ORDER BY gender"
            ).fetchall()
        )
        attempt_rows = rows_to_dict(
            self.connection.execute(
                "SELECT gender, status, COUNT(*) AS attempts FROM attempts GROUP BY gender, status ORDER BY gender, status"
            ).fetchall()
        )
        outcome_rows = rows_to_dict(
            self.connection.execute(
                "SELECT COALESCE(gender, 'all') AS gender, COUNT(*) AS completed_attempts, "
                "ROUND(AVG(good_percent), 2) AS avg_good_percent, ROUND(AVG(improve_percent), 2) AS avg_improve_percent, "
                "ROUND(AVG(consult_percent), 2) AS avg_consult_percent, SUM(good_count) AS good_answers, "
                "SUM(improve_count) AS improve_answers, SUM(consult_count) AS consult_answers "
                "FROM attempts WHERE status='completed' GROUP BY gender"
            ).fetchall()
        )
        all_outcome = self.connection.execute(
            "SELECT COUNT(*) AS completed_attempts, ROUND(AVG(good_percent), 2) AS avg_good_percent, "
            "ROUND(AVG(improve_percent), 2) AS avg_improve_percent, ROUND(AVG(consult_percent), 2) AS avg_consult_percent, "
            "SUM(good_count) AS good_answers, SUM(improve_count) AS improve_answers, SUM(consult_count) AS consult_answers "
            "FROM attempts WHERE status='completed'"
        ).fetchone()
        indicator_rows = rows_to_dict(
            self.connection.execute(
                "SELECT a.gender, aa.indicator, COUNT(*) AS answers, ROUND(AVG(aa.points), 2) AS avg_score, "
                "ROUND(100.0 * SUM(CASE WHEN aa.category='good' THEN 1 ELSE 0 END) / COUNT(*), 2) AS good_percent, "
                "ROUND(100.0 * SUM(CASE WHEN aa.category='improve' THEN 1 ELSE 0 END) / COUNT(*), 2) AS improve_percent, "
                "ROUND(100.0 * SUM(CASE WHEN aa.category='consult' THEN 1 ELSE 0 END) / COUNT(*), 2) AS consult_percent "
                "FROM attempt_answers aa JOIN attempts a ON a.id=aa.attempt_id WHERE a.status='completed' "
                "GROUP BY a.gender, aa.indicator ORDER BY a.gender, aa.indicator"
            ).fetchall()
        )
        for row in indicator_rows:
            row["indicator_name"] = INDICATOR_NAMES.get(row["indicator"], row["indicator"])
        return {
            "participants": participant_rows,
            "attempts": attempt_rows,
            "outcomes_by_gender": outcome_rows,
            "outcomes_all": dict(all_outcome) if all_outcome else {},
            "indicators": indicator_rows,
        }

    def export_completed_attempts(self, path: str) -> int:
        import csv

        rows = self.connection.execute(
            "SELECT id, chat_id, gender, started_at, completed_at, questions_total, good_count, improve_count, consult_count, "
            "good_percent, improve_percent, consult_percent FROM attempts WHERE status='completed' ORDER BY completed_at"
        ).fetchall()
        with open(path, "w", newline="", encoding="utf-8-sig") as handle:
            writer = csv.writer(handle)
            writer.writerow(rows[0].keys() if rows else ["id", "chat_id", "gender"])
            writer.writerows([tuple(row) for row in rows])
        return len(rows)


def load_questions() -> list[dict[str, Any]]:
    path = ROOT / "questions.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    if len(data) != 40:
        raise RuntimeError("questions.json باید دقیقاً ۴۰ سوال داشته باشد.")
    return data


def inline_keyboard(rows: Iterable[Iterable[dict[str, str]]]) -> dict[str, Any]:
    return {"inline_keyboard": [list(row) for row in rows]}


def button(text: str, data: str) -> dict[str, str]:
    return {"text": text, "callback_data": data}


def digits(value: int) -> str:
    return str(value).translate(str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹"))


def question_keyboard(question: dict[str, Any]) -> dict[str, Any]:
    return inline_keyboard(
        [[button(f"{option['key']}) {option['text']}", f"answer:{question['id']}:{option['key']}")] for option in question["options"]]
    )


def gender_keyboard() -> dict[str, Any]:
    return inline_keyboard(
        [[button("👨 پسر هستم", "gender:male"), button("👩 دختر هستم", "gender:female")]]
    )


def welcome_keyboard() -> dict[str, Any]:
    return inline_keyboard([[button("▶️ شروع آزمون", "start")]])


def restart_keyboard() -> dict[str, Any]:
    return inline_keyboard([[button("🔄 آزمون مجدد", "start")]])


def welcome_text() -> str:
    return (
        "🧭 آزمون شناخت پیش از ازدواج\n\n"
        "این آزمون به شما کمک می‌کند درباره چند شاخص مهم گفت‌وگو کنید. "
        "نتیجه، غربالگری و نقطه شروع گفت‌وگوست و نظر قطعی درباره مناسب‌بودن ازدواج یا شخصیت افراد نیست.\n\n"
        "با زدن دکمه شروع، جنسیت خود را انتخاب کنید تا مجموعه سوال مناسب نمایش داده شود."
    )


def question_text(question: dict[str, Any], number: int, total: int) -> str:
    return (
        f"❓ سوال {digits(number)} از {digits(total)}\n\n"
        f"{question['title']}"
    )


INDICATOR_NAMES = {
    "privacy": "اعتماد و حریم خصوصی",
    "family": "مرزبندی با خانواده‌ها",
    "finance": "شفافیت و مدیریت مالی",
    "conflict": "حل تعارض و مسئولیت‌پذیری",
    "honesty": "صداقت و شفافیت اطلاعاتی",
    "compatibility": "سازگاری و برنامه آینده",
    "independence": "استقلال و احترام به انتخاب‌ها",
    "cooperation": "همکاری و تقسیم نقش‌ها",
    "growth": "یادگیری و آمادگی برای مشاوره",
    "intimacy": "صمیمیت، رضایت و فرزندآوری",
    "safety": "امنیت و سلامت رابطه",
    "lifestyle": "سبک زندگی و انتظارات",
    "legal": "حقوق و توافق‌های قانونی",
}

# Each question contributes to one relationship indicator. IDs 1–20 are the
# male questionnaire and IDs 21–40 are the female questionnaire.
INDICATOR_BY_ID = {
    1: "privacy", 2: "family", 3: "finance", 4: "conflict", 5: "honesty",
    6: "compatibility", 7: "independence", 8: "cooperation", 9: "growth",
    10: "conflict", 11: "privacy", 12: "conflict", 13: "compatibility",
    14: "lifestyle", 15: "family", 16: "family", 17: "safety", 18: "finance",
    19: "safety", 20: "intimacy", 21: "independence", 22: "independence",
    23: "finance", 24: "cooperation", 25: "family", 26: "safety",
    27: "independence", 28: "intimacy", 29: "safety", 30: "legal",
    31: "finance", 32: "privacy", 33: "honesty", 34: "compatibility",
    35: "intimacy", 36: "compatibility", 37: "safety", 38: "family",
    39: "finance", 40: "conflict",
}


def classify_answer(question: dict[str, Any], selected: str | None) -> tuple[str, int]:
    """Return (category, points) for one answer.

    Healthy responses score 100, improvement signals score 50, and serious
    risk signals score 0. An unanswered discussion item is treated as needing
    improvement rather than as a positive or negative assumption.
    """
    if selected == "د" or not selected:
        return "improve", 50
    if selected in question["risk_keys"]:
        if question["risk_level"] == "consult":
            return "consult", 0
        return "improve", 50
    return "good", 100


def score_answers(questions: list[dict[str, Any]], answers: dict[str, str]) -> dict[str, Any]:
    overall: dict[str, int] = {"good": 0, "improve": 0, "consult": 0}
    indicators: dict[str, dict[str, int]] = {}
    for question in questions:
        category, points = classify_answer(question, answers.get(str(question["id"])))
        overall[category] += 1
        key = INDICATOR_BY_ID.get(question["id"], "lifestyle")
        stat = indicators.setdefault(key, {"total": 0, "points": 0, "good": 0, "improve": 0, "consult": 0})
        stat["total"] += 1
        stat["points"] += points
        stat[category] += 1

    grouped_indicators: dict[str, list[str]] = {"good": [], "improve": [], "consult": []}
    for key, stat in indicators.items():
        if stat["consult"]:
            category = "consult"
        elif stat["improve"]:
            category = "improve"
        else:
            category = "good"
        grouped_indicators[category].append(INDICATOR_NAMES[key])

    total = max(len(questions), 1)
    return {
        "overall": overall,
        "total": total,
        "percentages": {
            "good": round(overall["good"] * 100 / total),
            "improve": round(overall["improve"] * 100 / total),
            "consult": round(overall["consult"] * 100 / total),
        },
        "indicators": indicators,
        "grouped_indicators": grouped_indicators,
    }


def build_recommendation(score: dict[str, Any]) -> str:
    overall = score["overall"]
    grouped = score["grouped_indicators"]
    good_names = "، ".join(grouped["good"])
    improve_names = "، ".join(grouped["improve"])
    consult_names = "، ".join(grouped["consult"])
    if overall["consult"]:
        return (
            f"توصیه اختصاصی برای ادامه مسیر: در شاخص‌های «{consult_names}» پیش از هر تصمیم نهایی، "
            "موضوع‌ها را با حضور مشاور خانواده بررسی کنید و درباره مرزهای امن و رضایت دوطرفه به توافق روشن برسید. "
            f"در شاخص‌های «{improve_names or 'نیازمند اصلاح'}» نیز به‌جای وعده کلی، چند توافق رفتاری قابل سنجش تعیین کنید و پایبندی عملی هر دو نفر را در طول زمان بسنجید."
        )
    if overall["improve"]:
        return (
            f"توصیه اختصاصی برای ادامه مسیر: آشنایی را متوقف نکنید، اما پیش از جدی‌ترکردن رابطه روی شاخص‌های «{improve_names}» تمرکز کنید. "
            "برای هر موضوع یک گفت‌وگوی مشخص، راه‌حل مورد قبول دوطرف و زمان بازبینی تعیین کنید؛ سپس ببینید تغییر در رفتار واقعی و پایدار است یا فقط در حد قول می‌ماند. "
            f"نقاط قوت شما در «{good_names or 'شاخص‌های سازنده'}» می‌تواند پایه این گفت‌وگوها باشد."
        )
    return (
        f"توصیه اختصاصی برای ادامه مسیر: پاسخ‌ها در شاخص‌های «{good_names or 'رابطه'}» الگوی سازنده‌ای نشان می‌دهند. "
        "شناخت را با گفت‌وگو درباره ارزش‌ها، برنامه مالی، نقش خانواده و تصمیم‌های آینده ادامه دهید و قبل از تصمیم نهایی، توافق‌ها را در موقعیت‌های واقعی محک بزنید."
    )


def result_text(questions: list[dict[str, Any]], answers: dict[str, str]) -> str:
    score = score_answers(questions, answers)
    overall = score["overall"]
    percentages = score["percentages"]
    grouped_indicators = score["grouped_indicators"]

    def grouped_line(category: str, label: str) -> str:
        names = "، ".join(grouped_indicators[category]) or "موردی ثبت نشد"
        return f"{label}: {names}."

    lines = [
        "📊 تحلیل الگوریتمی نتیجه آزمون",
        "",
        f"✅ رفتار سازنده: {digits(percentages['good'])}٪ ({digits(overall['good'])} پاسخ)",
        f"⚠️ نیاز به اصلاح: {digits(percentages['improve'])}٪ ({digits(overall['improve'])} پاسخ)",
        f"🧭 نیاز به مراجعه به مشاور: {digits(percentages['consult'])}٪ ({digits(overall['consult'])} پاسخ)",
        "",
        "دسته‌بندی تجمیعی شاخص‌های رابطه:",
        grouped_line("good", "✅ رفتار سازنده"),
        grouped_line("improve", "⚠️ نیاز به اصلاح"),
        grouped_line("consult", "🧭 نیاز به مراجعه به مشاور"),
        "",
        build_recommendation(score),
    ]
    return "\n".join(lines)


def split_text(text: str, max_length: int = 3900) -> list[str]:
    parts: list[str] = []
    current = ""
    for line in text.splitlines():
        candidate = f"{current}\n{line}" if current else line
        if len(candidate) > max_length and current:
            parts.append(current)
            current = line
        else:
            current = candidate
    if current:
        parts.append(current)
    return parts or [""]


@dataclass
class QuizBot:
    api: BaleAPI
    store: SessionStore
    questions: list[dict[str, Any]]
    crm: RedlineCrmReporter | None = None

    def send(self, chat_id: int, text: str, markup: dict[str, Any] | None = None) -> int | None:
        messages = split_text(text)
        last_id: int | None = None
        for index, part in enumerate(messages):
            response = self.api.send_message(
                chat_id,
                part,
                markup if index == len(messages) - 1 else None,
            )
            if isinstance(response, dict):
                last_id = response.get("message_id")
        self.store.set_last_message(chat_id, last_id)
        return last_id

    def delete_callback_message(self, callback: dict[str, Any]) -> None:
        message = callback.get("message") or {}
        chat = message.get("chat") or {}
        message_id = message.get("message_id")
        if chat.get("id") is None or message_id is None:
            return
        try:
            self.api.delete_message(int(chat["id"]), int(message_id))
        except BaleAPIError:
            logging.debug("Could not delete previous message", exc_info=True)

    def handle_message(self, message: dict[str, Any]) -> None:
        chat = message.get("chat") or {}
        chat_id = chat.get("id")
        text = (message.get("text") or "").strip().lower()
        if chat_id is None:
            return
        if text in {"/start", "/restart", "شروع", "شروع آزمون"}:
            current = self.store.get(int(chat_id))
            if (
                current
                and current["gender"] is None
                and current["attempt_id"] is None
                and time.time() - float(current["updated_at"]) < 3
            ):
                return
            self.store.reset(int(chat_id))
            # The platform START button sends /start. Begin the quiz directly
            # so the user does not have to press a second "شروع آزمون" button.
            self.send(int(chat_id), "لطفاً جنسیت خود را انتخاب کنید.", gender_keyboard())
            return
        if text in {"/help", "راهنما"}:
            self.send(int(chat_id), welcome_text(), welcome_keyboard())
            return
        self.send(int(chat_id), "برای پاسخ‌دادن از دکمه‌های شیشه‌ای استفاده کنید یا /start را بزنید.", welcome_keyboard())

    def handle_callback(self, callback: dict[str, Any]) -> None:
        callback_id = callback.get("id")
        data = callback.get("data", "")
        message = callback.get("message") or {}
        chat_id = (message.get("chat") or {}).get("id")
        if not callback_id or chat_id is None:
            return
        chat_id = int(chat_id)
        try:
            self.api.answer_callback(callback_id)
        except BaleAPIError:
            logging.debug("Could not answer callback", exc_info=True)
        self.delete_callback_message(callback)

        if data == "start":
            current = self.store.get(chat_id)
            if (
                current
                and current["gender"] is None
                and current["attempt_id"] is None
                and time.time() - float(current["updated_at"]) < 3
            ):
                return
            self.store.reset(chat_id)
            self.send(chat_id, "لطفاً جنسیت خود را انتخاب کنید.", gender_keyboard())
            return
        if data.startswith("gender:"):
            gender = data.split(":", 1)[1]
            if gender not in {"male", "female"}:
                self.send(chat_id, "انتخاب نامعتبر است. لطفاً دوباره /start را بزنید.", welcome_keyboard())
                return
            self.store.reset(chat_id)
            self.store.save_gender(chat_id, gender)
            self.send_question(chat_id)
            return
        if data.startswith("answer:"):
            self.handle_answer(chat_id, data)
            return
        self.send(chat_id, "این دکمه دیگر فعال نیست. برای شروع دوباره /start را بزنید.", welcome_keyboard())

    def send_question(self, chat_id: int) -> None:
        row = self.store.get(chat_id)
        if not row or row["gender"] not in {"male", "female"}:
            self.send(chat_id, welcome_text(), welcome_keyboard())
            return
        offset = 0 if row["gender"] == "male" else 20
        index = int(row["question_index"])
        total = 20
        if index >= total:
            self.send_final_result(
                chat_id,
                self.questions[offset : offset + total],
                self.store.answers(chat_id),
            )
            return
        question = self.questions[offset + index]
        self.send(chat_id, question_text(question, index + 1, total), question_keyboard(question))

    def handle_answer(self, chat_id: int, data: str) -> None:
        try:
            _, question_id_raw, key = data.split(":", 2)
            question_id = int(question_id_raw)
        except ValueError:
            self.send(chat_id, "پاسخ نامعتبر است. برای شروع دوباره /start را بزنید.", welcome_keyboard())
            return
        row = self.store.get(chat_id)
        if not row or row["gender"] not in {"male", "female"}:
            self.send(chat_id, welcome_text(), welcome_keyboard())
            return
        offset = 0 if row["gender"] == "male" else 20
        expected = self.questions[offset + int(row["question_index"])] if int(row["question_index"]) < 20 else None
        if key not in OPTION_KEYS or not expected or expected["id"] != question_id:
            self.send(chat_id, "این پاسخ مربوط به سوال فعلی نیست. لطفاً از /start دوباره شروع کنید.", welcome_keyboard())
            return
        self.store.save_answer(chat_id, question_id, key)
        if int(row["question_index"]) + 1 >= 20:
            self.send_final_result(
                chat_id,
                self.questions[offset : offset + 20],
                self.store.answers(chat_id),
            )
        else:
            self.send_question(chat_id)

    def send_final_result(
        self,
        chat_id: int,
        questions: list[dict[str, Any]],
        answers: dict[str, str],
    ) -> None:
        report = result_text(questions, answers)
        row = self.store.get(chat_id)
        gender = row["gender"] if row and row["gender"] in {"male", "female"} else "unknown"
        attempt = self.store.complete_attempt(chat_id, gender, questions, answers, report)
        if self.crm:
            try:
                self.crm.completed(attempt, self.store.participant(chat_id), questions, answers)
            except Exception:
                logging.exception("ثبت نتیجه آزمون در صف CRM ناموفق بود")
        self.send(chat_id, report, restart_keyboard())

    def process_update(self, update: dict[str, Any]) -> None:
        if update.get("callback_query"):
            callback = update["callback_query"]
            chat_id = ((callback.get("message") or {}).get("chat") or {}).get("id")
            if chat_id is not None:
                self.store.save_identity(int(chat_id), callback.get("from") or {})
            self.handle_callback(update["callback_query"])
        elif update.get("message"):
            message = update["message"]
            chat_id = (message.get("chat") or {}).get("id")
            if chat_id is not None:
                self.store.save_identity(int(chat_id), message.get("from") or {})
            self.handle_message(update["message"])


def run(settings: dict[str, str], once: bool = False) -> None:
    token = read_token(settings)
    api = BaleAPI(token, settings.get("BALE_API_BASE", "https://tapi.bale.ai/bot"))
    me = api.get_me()
    logging.info("ربات آماده است: @%s", me.get("username", "unknown"))
    store = SessionStore(settings.get("STATE_DB", str(ROOT / "bot_state.sqlite3")))
    crm = RedlineCrmReporter(settings)
    if crm.client.enabled:
        logging.info("ارسال پایدار آمار به CRM فعال است")
    else:
        logging.warning("ارسال CRM غیرفعال است؛ CRM_URL و CRM_API_KEY تنظیم نشده‌اند")
    bot = QuizBot(api, store, load_questions(), crm)
    health_server = start_health_server(
        settings.get("HEALTH_HOST", "127.0.0.1"),
        int(settings.get("HEALTH_PORT", "18115")),
    )
    if health_server:
        logging.info("health endpoint روی %s:%s فعال است", settings.get("HEALTH_HOST", "127.0.0.1"), settings.get("HEALTH_PORT", "18115"))
    offset: int | None = None
    running = True

    def stop(*_: Any) -> None:
        nonlocal running
        running = False

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    while running:
        try:
            updates = api.get_updates(offset, int(settings.get("POLL_TIMEOUT", "25")))
            for update in updates:
                offset = int(update["update_id"]) + 1
                try:
                    bot.process_update(update)
                except Exception:
                    logging.exception("پردازش یک update ناموفق بود")
            if once:
                break
        except BaleAPIError as exc:
            logging.error("خطای API: %s", exc)
            if once:
                raise
            time.sleep(3)
    if health_server:
        health_server.shutdown()


def main() -> None:
    parser = argparse.ArgumentParser(description="Bale marriage readiness quiz bot")
    parser.add_argument("--check", action="store_true", help="اعتبارسنجی کلید و اتصال به API")
    parser.add_argument("--stats", action="store_true", help="نمایش آمار شرکت‌کنندگان و نتایج تکمیل‌شده")
    parser.add_argument("--export-csv", metavar="PATH", help="خروجی CSV آزمون‌های تکمیل‌شده")
    parser.add_argument("--once", action="store_true", help="یک بار updateها را دریافت و سپس خارج شود")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    settings = read_settings()
    if args.stats or args.export_csv:
        store = SessionStore(settings.get("STATE_DB", str(ROOT / "bot_state.sqlite3")))
        if args.stats:
            print(json.dumps(store.get_stats(), ensure_ascii=True, indent=2))
        if args.export_csv:
            count = store.export_completed_attempts(args.export_csv)
            print(json.dumps({"exported_attempts": count, "path": args.export_csv}, ensure_ascii=True))
        return
    if args.check:
        me = BaleAPI(read_token(settings), settings["BALE_API_BASE"]).get_me()
        print(json.dumps({"ok": True, "id": me.get("id"), "username": me.get("username")}, ensure_ascii=False))
        return
    run(settings, once=args.once)


if __name__ == "__main__":
    main()
