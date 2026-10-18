"""Queue every completed historical Redline attempt for idempotent CRM import."""
from __future__ import annotations

import argparse
import json
import logging

from bot import INDICATOR_BY_ID, SessionStore, load_questions, read_settings, score_answers
from crm_reporter import RedlineCrmReporter


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", default="bot_state.sqlite3")
    parser.add_argument("--wait", type=float, default=30.0)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    store = SessionStore(args.database)
    reporter = RedlineCrmReporter(read_settings())
    if not reporter.client.enabled:
        raise SystemExit("CRM_URL and CRM_API_KEY must be configured")
    questions = load_questions()
    question_by_id = {int(question["id"]): question for question in questions}
    queued = 0
    rows = store.connection.execute(
        "SELECT * FROM attempts WHERE status='completed' ORDER BY id"
    ).fetchall()
    for row in rows:
        answer_rows = store.connection.execute(
            "SELECT question_id, option_key FROM attempt_answers WHERE attempt_id=? ORDER BY question_id",
            (row["id"],),
        ).fetchall()
        answers = {str(answer["question_id"]): answer["option_key"] for answer in answer_rows}
        selected_questions = [
            question_by_id[int(answer["question_id"])]
            for answer in answer_rows
            if int(answer["question_id"]) in question_by_id
        ]
        score = score_answers(selected_questions, answers)
        attempt = {
            "attemptId": row["id"],
            "chatId": row["chat_id"],
            "gender": row["gender"],
            "startedAt": row["started_at"],
            "completedAt": row["completed_at"],
            "scores": {
                "goodPercent": row["good_percent"],
                "improvePercent": row["improve_percent"],
                "consultPercent": row["consult_percent"],
            },
            "result": {
                "goodCount": row["good_count"],
                "improveCount": row["improve_count"],
                "consultCount": row["consult_count"],
                "indicators": score["indicators"],
                "groupedIndicators": score["grouped_indicators"],
            },
            "indicatorsByQuestion": {
                str(question["id"]): INDICATOR_BY_ID.get(question["id"], "lifestyle")
                for question in selected_questions
            },
            "reportText": row["report_text"],
        }
        if reporter.completed(
            attempt,
            store.participant(int(row["chat_id"])),
            selected_questions,
            answers,
        ):
            queued += 1

    delivered = reporter.client.wait(args.wait)
    print(json.dumps({"completed": len(rows), "queued": queued, "delivered": delivered}))


if __name__ == "__main__":
    main()
