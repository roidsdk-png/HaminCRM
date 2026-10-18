"""Dependency-free, non-blocking CRM sender with an optional durable outbox."""
from __future__ import annotations

import json
import logging
import hashlib
import os
import queue
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4


class CrmClient:
    def __init__(self, base_url: str, source: str, api_key: str, timeout: float = 2.0, outbox_dir: str = "") -> None:
        clean_base_url = base_url.strip().rstrip("/")
        self.url = clean_base_url + "/api/v1/events" if clean_base_url else ""
        self.source = source.strip()
        self.api_key = api_key.strip()
        self.timeout = timeout
        self.outbox = Path(outbox_dir).expanduser() if outbox_dir.strip() else None
        self._outbox_ready = self.outbox is None
        self._queue: queue.Queue[dict[str, Any] | Path] = queue.Queue()
        if self.enabled and self.outbox:
            try:
                self.outbox.mkdir(parents=True, exist_ok=True)
                self._outbox_ready = True
                for item in sorted(self.outbox.glob("*.json")):
                    self._queue.put_nowait(item)
            except OSError:
                logging.exception("CRM outbox could not be initialized")
                self._outbox_ready = False
        self._worker = threading.Thread(target=self._run, name="crm-sender", daemon=True)
        self._worker.start()

    @property
    def enabled(self) -> bool:
        return bool(self.url and self.source and self.api_key)

    def send(self, event_id: str, event_type: str, payload: dict[str, Any], occurred_at: str | None = None) -> bool:
        if not self.enabled or not self._outbox_ready:
            return False
        event = {"eventId": event_id, "type": event_type, "occurredAt": occurred_at or datetime.now(timezone.utc).isoformat(), "payload": payload}
        try:
            queued: dict[str, Any] | Path = self._persist(event) if self.outbox else event
            self._queue.put_nowait(queued)
            return True
        except OSError:
            logging.exception("CRM event %s could not be saved to the outbox", event_id)
            return False

    def message(self, event_id: str, session_id: str, user_id: str, role: str, content: str, **extra: Any) -> bool:
        return self.send(event_id, "message.created", {"sessionId": session_id, "userId": user_id, "role": role, "content": content, **extra})

    def _run(self) -> None:
        consecutive_failures = 0
        while True:
            queued = self._queue.get()
            event = None
            try:
                event = self._load(queued)
                if event is None:
                    continue
                self._deliver(event)
                if isinstance(queued, Path):
                    queued.unlink(missing_ok=True)
                consecutive_failures = 0
            except Exception:
                event_id = event.get("eventId") if event else "unknown"
                logging.exception("CRM delivery failed for event %s", event_id)
                if isinstance(queued, Path):
                    time.sleep(min(60, 5 * 2 ** min(consecutive_failures, 4)))
                    consecutive_failures += 1
                    self._queue.put_nowait(queued)
            finally:
                self._queue.task_done()

    def _persist(self, event: dict[str, Any]) -> Path:
        assert self.outbox is not None
        digest = hashlib.sha256(event["eventId"].encode("utf-8")).hexdigest()
        target = self.outbox / f"{digest}.json"
        temporary = self.outbox / f".{digest}.{uuid4().hex}.tmp"
        with temporary.open("w", encoding="utf-8") as handle:
            json.dump(event, handle, ensure_ascii=False)
            handle.flush()
            os.fsync(handle.fileno())
        temporary.replace(target)
        return target

    @staticmethod
    def _load(queued: dict[str, Any] | Path) -> dict[str, Any] | None:
        if isinstance(queued, dict):
            return queued
        try:
            with queued.open("r", encoding="utf-8") as handle:
                value = json.load(handle)
            return value if isinstance(value, dict) else None
        except FileNotFoundError:
            return None

    def _deliver(self, event: dict[str, Any]) -> None:
        body = json.dumps(event, ensure_ascii=False).encode("utf-8")
        request = urllib.request.Request(self.url, data=body, method="POST", headers={"Content-Type": "application/json", "X-CRM-Source": self.source, "X-CRM-Key": self.api_key})
        for attempt in range(3):
            try:
                with urllib.request.urlopen(request, timeout=self.timeout) as response:
                    if 200 <= response.status < 300:
                        return
                    raise RuntimeError(f"CRM returned HTTP {response.status}")
            except urllib.error.HTTPError as error:
                if error.code < 500 and error.code not in (408, 429):
                    raise RuntimeError(f"CRM returned HTTP {error.code}") from error
                if attempt == 2:
                    raise
                time.sleep(0.25 * (2**attempt))
            except (urllib.error.URLError, TimeoutError, RuntimeError):
                if attempt == 2:
                    raise
                time.sleep(0.25 * (2**attempt))
