# -*- coding: utf-8 -*-
"""
سرویس وب و API آزمون خط قرمزها و شناخت پیش از ازدواج (Redline Quiz)
مخصوص اتصال به وب‌اپلیکیشن تلگرام با دیتابیس مشترک با ربات بله
و اتصال یکپارچه به سامانه CRM
"""

from __future__ import annotations

import json
import logging
import os
import sqlite3
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

# تنظیم مسیر روت
ROOT = Path(__file__).resolve().parent

# واردسازی ماژول‌های اصلی پروژه redline-bot
from bot import (
    load_questions,
    score_answers,
    classify_answer,
    result_text,
    build_recommendation,
    INDICATOR_NAMES,
    INDICATOR_BY_ID,
    SessionStore,
    read_settings,
)
from crm_reporter import RedlineCrmReporter

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("redline-web")

# بارگذاری تنظیمات و CRM
settings = read_settings()
crm_reporter = RedlineCrmReporter(settings)

# بارگذاری سوالات ۴۰ گانه (۱ تا ۲۰ پسرها، ۲۱ تا ۴۰ دخترها)
ALL_QUESTIONS = load_questions()
MALE_QUESTIONS = ALL_QUESTIONS[0:20]
FEMALE_QUESTIONS = ALL_QUESTIONS[20:40]

DB_PATH = str(ROOT / "bot_state.sqlite3")
STATIC_HTML_PATH = ROOT / "static" / "index.html"


def ensure_db_wal():
    """تنظیم حالت WAL و timeout جهت امکان نوشتن همزمان بله و تلگرام بدون قفل دیتابیس"""
    try:
        conn = sqlite3.connect(DB_PATH, timeout=10.0)
        mode = conn.execute("PRAGMA journal_mode = WAL;").fetchone()[0]
        conn.execute("PRAGMA busy_timeout = 5000;")
        conn.close()
        logger.info("SQLite journal_mode set to: %s (busy_timeout=5000ms)", mode)
    except Exception as e:
        logger.warning("Could not set SQLite WAL mode: %s", e)


class RedlineWebHandler(BaseHTTPRequestHandler):
    server_version = "RedlineWeb/1.0"

    def _send_json(self, data: dict, status_code: int = 200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._set_cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def _set_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS, HEAD")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")
        self.send_header("X-Content-Type-Options", "nosniff")

    def do_OPTIONS(self):
        self.send_response(204)
        self._set_cors_headers()
        self.end_headers()

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/")
        # در صورت ارسال درخواست با پیشوند /redline
        if path.startswith("/redline"):
            path = path[8:]

        # ── ۱. مسیر صفحه وب‌اپلیکیشن ──
        if path in {"", "/", "/index.html"}:
            if STATIC_HTML_PATH.exists():
                content = STATIC_HTML_PATH.read_bytes()
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(content)))
                self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
                self._set_cors_headers()
                self.end_headers()
                self.wfile.write(content)
            else:
                self.send_error(404, "Static index.html not found")
            return

        # ── ۲. مسیر وضعیت سیستم (Status / Health) ──
        if path in {"/api/status", "/health"}:
            try:
                conn = sqlite3.connect(DB_PATH, timeout=5.0)
                conn.row_factory = sqlite3.Row
                total_parts = conn.execute("SELECT COUNT(*) FROM participants").fetchone()[0]
                total_attempts = conn.execute("SELECT COUNT(*) FROM attempts WHERE status='completed'").fetchone()[0]
                conn.close()

                self._send_json({
                    "ok": True,
                    "service": "redline-web",
                    "status": "online",
                    "total_participants": total_parts,
                    "completed_attempts": total_attempts,
                })
            except Exception as e:
                logger.error("Error in /api/status: %s", e)
                self._send_json({"ok": False, "error": str(e)}, 500)
            return

        # ── ۳. دریافت لیست سوالات بر اساس جنسیت ──
        if path == "/api/questions":
            query = parse_qs(parsed.query)
            gender = query.get("gender", ["male"])[0].lower()
            q_list = FEMALE_QUESTIONS if gender == "female" else MALE_QUESTIONS

            # فیلتر فیلدهای حساس (ارسال فقط id, title, options بدون افشای کلیدهای خطر)
            sanitized = [
                {
                    "id": q["id"],
                    "title": q["title"],
                    "options": [
                        {"key": opt["key"], "text": opt["text"]}
                        for opt in q.get("options", [])
                    ]
                }
                for q in q_list
            ]

            self._send_json({
                "ok": True,
                "gender": gender,
                "total": len(sanitized),
                "questions": sanitized
            })
            return

        self.send_error(404, "Path not found")

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/")
        if path.startswith("/redline"):
            path = path[8:]

        # ── ۴. ثبت پاسخ‌های آزمون و محاسبه نتیجه ──
        if path == "/api/submit":
            try:
                content_len = int(self.headers.get("Content-Length", 0))
                raw_body = self.rfile.read(content_len).decode("utf-8")
                data = json.loads(raw_body)
            except Exception as e:
                logger.warning("Invalid JSON in submit: %s", e)
                self._send_json({"ok": False, "error": "داده‌های ارسالی نامعتبر است"}, 400)
                return

            gender = str(data.get("gender", "male")).lower()
            if gender not in {"male", "female"}:
                self._send_json({"ok": False, "error": "جنسیت مشخص نشده است"}, 400)
                return

            answers = data.get("answers", {})
            if not isinstance(answers, dict):
                self._send_json({"ok": False, "error": "پاسخ‌ها باید به صورت دیکشنری ارسال شوند"}, 400)
                return

            questions = FEMALE_QUESTIONS if gender == "female" else MALE_QUESTIONS
            valid_answers = {
                str(question["id"]): {str(option["key"]) for option in question.get("options", [])}
                for question in questions
            }
            if any(answers.get(question_id) not in option_keys for question_id, option_keys in valid_answers.items()):
                self._send_json({"ok": False, "error": f"لطفاً به تمامی {len(questions)} سوال پاسخ دهید"}, 400)
                return

            # تفکیک شناسه کاربری تلگرام (افزودن پیشوند ۹ تریلیون برای عدم تداخل با آی‌دی‌های بله)
            raw_chat_id = data.get("chat_id")
            first_name = str(data.get("first_name", "")).strip()
            last_name = str(data.get("last_name", "")).strip()
            username = str(data.get("username", "")).strip().lstrip("@")

            now = time.time()
            try:
                tg_id_int = int(raw_chat_id) if raw_chat_id else 0
            except (ValueError, TypeError):
                tg_id_int = 0

            if tg_id_int > 0:
                if tg_id_int < 9000000000000:
                    chat_id = 9000000000000 + tg_id_int
                else:
                    chat_id = tg_id_int
            else:
                # کاربر بدون شناسه وب
                chat_id = int(now * 1000)

            # محاسبه امتیازات و تحلیل بر اساس الگوریتم استاندارد
            score = score_answers(questions, answers)
            overall = score["overall"]
            percentages = score["percentages"]
            report = result_text(questions, answers)
            recommendation = build_recommendation(score)

            # ثبت در دیتابیس مشترک SQLite
            try:
                conn = sqlite3.connect(DB_PATH, timeout=10.0)
                conn.row_factory = sqlite3.Row

                # ثبت / به‌روزرسانی در جدول participants
                conn.execute(
                    "INSERT INTO participants(chat_id, first_seen_at, last_seen_at, last_gender, completed_attempts, first_name, last_name, username) "
                    "VALUES(?, ?, ?, ?, 1, ?, ?, ?) ON CONFLICT(chat_id) DO UPDATE SET "
                    "last_seen_at=excluded.last_seen_at, "
                    "last_gender=excluded.last_gender, "
                    "completed_attempts=completed_attempts+1, "
                    "first_name=COALESCE(NULLIF(excluded.first_name,''),participants.first_name), "
                    "last_name=COALESCE(NULLIF(excluded.last_name,''),participants.last_name), "
                    "username=COALESCE(NULLIF(excluded.username,''),participants.username)",
                    (chat_id, now, now, gender, first_name, last_name, f"@{username}" if username else None),
                )

                # ثبت نوبت آزمون (attempt)
                cursor = conn.execute(
                    "INSERT INTO attempts(chat_id, gender, status, started_at, completed_at, questions_total, "
                    "good_count, improve_count, consult_count, good_percent, improve_percent, consult_percent, report_text) "
                    "VALUES(?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        chat_id,
                        gender,
                        now - 120,  # شروع تخمینی ۲ دقیقه قبل
                        now,
                        len(questions),
                        overall["good"],
                        overall["improve"],
                        overall["consult"],
                        percentages["good"],
                        percentages["improve"],
                        percentages["consult"],
                        report,
                    ),
                )
                attempt_id = int(cursor.lastrowid)

                # ثبت تک‌تک پاسخ‌ها در جدول attempt_answers
                conn.executemany(
                    "INSERT OR REPLACE INTO attempt_answers(attempt_id, question_id, option_key, category, points, indicator) "
                    "VALUES(?, ?, ?, ?, ?, ?)",
                    [
                        (
                            attempt_id,
                            q["id"],
                            answers.get(str(q["id"]), "د"),
                            classify_answer(q, answers.get(str(q["id"])))[0],
                            classify_answer(q, answers.get(str(q["id"])))[1],
                            INDICATOR_BY_ID.get(q["id"], "lifestyle"),
                        )
                        for q in questions
                    ],
                )

                conn.commit()
                conn.close()
                logger.info("Successfully saved Redline attempt: id=%d chat_id=%s gender=%s good=%d%%",
                            attempt_id, chat_id, gender, percentages["good"])

            except Exception as db_err:
                logger.exception("Database error while saving attempt: %s", db_err)
                self._send_json({"ok": False, "error": "خطا در ذخیره‌سازی نتایج دیتابیس"}, 500)
                return

            # گزارش رویداد به CRM مرکزی حامین
            try:
                attempt_payload = {
                    "attemptId": attempt_id,
                    "chatId": chat_id,
                    "gender": gender,
                    "startedAt": now - 120,
                    "completedAt": now,
                    "scores": {
                        "goodPercent": percentages["good"],
                        "improvePercent": percentages["improve"],
                        "consultPercent": percentages["consult"],
                    },
                    "result": {
                        "goodCount": overall["good"],
                        "improveCount": overall["improve"],
                        "consultCount": overall["consult"],
                        "indicators": score["indicators"],
                        "groupedIndicators": score["grouped_indicators"],
                    },
                    "indicatorsByQuestion": {
                        str(q["id"]): INDICATOR_BY_ID.get(q["id"], "lifestyle")
                        for q in questions
                    },
                    "reportText": report,
                }
                participant_payload = {
                    "userId": str(tg_id_int or chat_id),
                    "firstName": first_name,
                    "lastName": last_name,
                    "username": username,
                    "platform": "telegram",
                }
                queued = crm_reporter.completed(attempt_payload, participant_payload, questions, answers)
                if queued:
                    logger.info("Queued Telegram Redline completed attempt %d for CRM", attempt_id)
                else:
                    logger.warning("Telegram CRM sender is not configured; attempt %d remains available for backfill", attempt_id)
            except Exception as crm_err:
                logger.warning("CRM reporting error: %s", crm_err)

            # آماده‌سازی آرایه تفکیک شاخص‌ها برای نمایش در فرانت‌اند
            indicators_list = []
            for ind_key, ind_stat in score["indicators"].items():
                if ind_stat["consult"]:
                    status = "consult"
                elif ind_stat["improve"]:
                    status = "improve"
                else:
                    status = "good"

                total_pts = ind_stat["total"] * 100
                score_pct = round((ind_stat["points"] / total_pts) * 100) if total_pts else 100

                indicators_list.append({
                    "key": ind_key,
                    "name": INDICATOR_NAMES.get(ind_key, ind_key),
                    "status": status,
                    "score": score_pct,
                    "good": ind_stat["good"],
                    "improve": ind_stat["improve"],
                    "consult": ind_stat["consult"],
                })

            # ارسال پاسخ موفقیت‌آمیز به کلاینت
            self._send_json({
                "ok": True,
                "trackingCode": f"RL-{attempt_id}",
                "scores": {
                    "goodPercent": percentages["good"],
                    "improvePercent": percentages["improve"],
                    "consultPercent": percentages["consult"],
                },
                "overall": overall,
                "indicators": indicators_list,
                "grouped_indicators": score["grouped_indicators"],
                "recommendation": recommendation,
                "report_text": report,
            })
            return

        self.send_error(404, "Path not found")


def main():
    ensure_db_wal()
    host = "127.0.0.1"
    port = 8095
    server = ThreadingHTTPServer((host, port), RedlineWebHandler)
    logger.info("Redline Web App & API Server running on http://%s:%d", host, port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logger.info("Shutting down...")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
