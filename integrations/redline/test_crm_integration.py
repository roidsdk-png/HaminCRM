from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from bot import SessionStore, load_questions
from crm_reporter import RedlineCrmReporter


class FakeClient:
    def __init__(self) -> None:
        self.events = []

    def send(self, **event):
        self.events.append(event)
        return True


class CrmIntegrationTests(unittest.TestCase):
    def test_completed_attempt_contains_identity_answers_scores_and_result(self) -> None:
        questions = load_questions()[:20]
        answers = {str(question["id"]): question["options"][0]["key"] for question in questions}
        with tempfile.TemporaryDirectory() as directory:
            store = SessionStore(str(Path(directory) / "state.sqlite3"))
            store.reset(123)
            store.save_identity(123, {"first_name": "علی", "last_name": "نمونه", "username": "ali_test"})
            store.save_gender(123, "male")
            attempt = store.complete_attempt(123, "male", questions, answers, "گزارش")

            reporter = RedlineCrmReporter.__new__(RedlineCrmReporter)
            reporter.clients = {"bale": FakeClient(), "telegram": FakeClient()}
            reporter.client = reporter.clients["bale"]
            self.assertTrue(reporter.completed(attempt, store.participant(123), questions, answers))
            event = reporter.client.events[0]
            self.assertEqual(event["event_type"], "test.completed")
            self.assertEqual(event["event_id"], f"redline-bale-completed:{attempt['attemptId']}")
            self.assertEqual(event["payload"]["profile"]["userId"], "123")
            self.assertEqual(event["payload"]["profile"]["name"], "علی نمونه")
            self.assertEqual(len(event["payload"]["answers"]), 20)
            self.assertIn("goodPercent", event["payload"]["scores"])
            self.assertIn("indicators", event["payload"]["result"])

            telegram_participant = {
                "userId": "456",
                "firstName": "کاربر",
                "lastName": "تلگرام",
                "username": "tg_user",
                "platform": "telegram",
            }
            self.assertTrue(reporter.completed(attempt, telegram_participant, questions, answers))
            telegram_event = reporter.clients["telegram"].events[0]
            self.assertEqual(telegram_event["event_id"], f"redline-telegram-completed:{attempt['attemptId']}")
            self.assertEqual(telegram_event["payload"]["profile"]["userId"], "456")
            self.assertEqual(telegram_event["payload"]["profile"]["platform"], "telegram")
            self.assertEqual(telegram_event["payload"]["trackingCode"], f"RL-TG-{attempt['attemptId']}")
            store.connection.close()


if __name__ == "__main__":
    unittest.main()
