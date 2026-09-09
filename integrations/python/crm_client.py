"""Dependency-free, non-blocking CRM sender for long-running Python bots."""
from __future__ import annotations

import json
import logging
import queue
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any


class CrmClient:
    def __init__(self, base_url: str, source: str, api_key: str, timeout: float = 2.0) -> None:
        clean_base_url = base_url.strip().rstrip("/")
        self.url = clean_base_url + "/api/v1/events" if clean_base_url else ""
        self.source = source.strip()
        self.api_key = api_key.strip()
        self.timeout = timeout
        self._queue: queue.Queue[dict[str, Any]] = queue.Queue(maxsize=2000)
        self._worker = threading.Thread(target=self._run, name="crm-sender", daemon=True)
        self._worker.start()

    @property
    def enabled(self) -> bool:
        return bool(self.url and self.source and self.api_key)

    def send(self, event_id: str, event_type: str, payload: dict[str, Any], occurred_at: str | None = None) -> bool:
        if not self.enabled:
            return False
        event = {"eventId": event_id, "type": event_type, "occurredAt": occurred_at or datetime.now(timezone.utc).isoformat(), "payload": payload}
        try:
            self._queue.put_nowait(event)
            return True
        except queue.Full:
            logging.warning("CRM queue is full; event %s was not queued", event_id)
            return False

    def message(self, event_id: str, session_id: str, user_id: str, role: str, content: str, **extra: Any) -> bool:
        return self.send(event_id, "message.created", {"sessionId": session_id, "userId": user_id, "role": role, "content": content, **extra})

    def _run(self) -> None:
        while True:
            event = self._queue.get()
            try:
                self._deliver(event)
            except Exception:
                logging.exception("CRM delivery failed for event %s", event.get("eventId"))
            finally:
                self._queue.task_done()

    def _deliver(self, event: dict[str, Any]) -> None:
        body = json.dumps(event, ensure_ascii=False).encode("utf-8")
        request = urllib.request.Request(self.url, data=body, method="POST", headers={"Content-Type": "application/json", "X-CRM-Source": self.source, "X-CRM-Key": self.api_key})
        for attempt in range(3):
            try:
                with urllib.request.urlopen(request, timeout=self.timeout) as response:
                    if 200 <= response.status < 300:
                        return
            except (urllib.error.URLError, TimeoutError):
                if attempt == 2:
                    raise
                time.sleep(0.25 * (2**attempt))
