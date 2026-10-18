"""Map Redline quiz attempts to the central Hamin CRM event contract."""
from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from crm_client import CrmClient


def iso_time(timestamp: float) -> str:
    return datetime.fromtimestamp(timestamp, timezone.utc).isoformat()


class RedlineCrmReporter:
    def __init__(self, settings: dict[str, str] | None = None) -> None:
        settings = settings or {}
        default_outbox = Path(__file__).resolve().parent / "crm-outbox"
        base_url = settings.get("CRM_URL", os.getenv("CRM_URL", ""))
        outbox = Path(settings.get("CRM_OUTBOX_DIR", os.getenv("CRM_OUTBOX_DIR", str(default_outbox))))
        self.clients = {
            "bale": CrmClient(
                base_url,
                settings.get("CRM_SOURCE", os.getenv("CRM_SOURCE", "redline-test")),
                settings.get("CRM_API_KEY", os.getenv("CRM_API_KEY", "")),
                outbox_dir=str(outbox),
            ),
            "telegram": CrmClient(
                base_url,
                settings.get("CRM_TELEGRAM_SOURCE", os.getenv("CRM_TELEGRAM_SOURCE", "redline-telegram")),
                settings.get("CRM_TELEGRAM_API_KEY", os.getenv("CRM_TELEGRAM_API_KEY", "")),
                outbox_dir=str(outbox / "telegram"),
            ),
        }
        # Compatibility for the Bale backfill utility.
        self.client = self.clients["bale"]

    def completed(
        self,
        attempt: dict[str, Any],
        participant: dict[str, Any],
        questions: list[dict[str, Any]],
        answers: dict[str, str],
    ) -> bool:
        normalized_answers: list[dict[str, Any]] = []
        for question in questions:
            selected = answers.get(str(question["id"]))
            option = next((item for item in question.get("options", []) if item.get("key") == selected), None)
            category, points = self._classify(question, selected)
            normalized_answers.append(
                {
                    "questionKey": str(question["id"]),
                    "questionText": question["title"],
                    "value": selected,
                    "label": option.get("text") if option else None,
                    "score": points,
                    "metadata": {
                        "category": category,
                        "indicator": attempt.get("indicatorsByQuestion", {}).get(str(question["id"])),
                    },
                }
            )

        platform = str(participant.get("platform") or "bale").strip().lower()
        if platform not in self.clients:
            platform = "bale"
        client = self.clients[platform]
        user_id = str(participant.get("userId") or attempt["chatId"])
        attempt_id = str(attempt["attemptId"])
        name = " ".join(
            value.strip()
            for value in (str(participant.get("firstName") or ""), str(participant.get("lastName") or ""))
            if value.strip()
        )
        platform_code = "TG" if platform == "telegram" else "BL"
        username = str(participant.get("username") or "").strip().lstrip("@") or None
        return client.send(
            event_id=f"redline-{platform}-completed:{attempt_id}",
            event_type="test.completed",
            occurred_at=iso_time(float(attempt["completedAt"])),
            payload={
                "attemptId": attempt_id,
                "testKey": "redline-marriage-awareness",
                "trackingCode": f"RL-{platform_code}-{attempt_id}",
                "profile": {
                    "userId": user_id,
                    "name": name,
                    "gender": attempt.get("gender"),
                    f"{platform}Username": username,
                    "platform": platform,
                    "metadata": {"platform": platform, "username": username},
                },
                "answers": normalized_answers,
                "scores": attempt.get("scores", {}),
                "result": attempt.get("result", {}),
                "aiAnalysis": attempt.get("reportText"),
                "startedAt": iso_time(float(attempt["startedAt"])),
            },
        )

    @staticmethod
    def _classify(question: dict[str, Any], selected: str | None) -> tuple[str, int]:
        if selected == "د" or not selected:
            return "improve", 50
        if selected in question.get("risk_keys", []):
            return ("consult", 0) if question.get("risk_level") == "consult" else ("improve", 50)
        return "good", 100
