"""Regression tests for the durable CRM senders used by Python bots."""
from __future__ import annotations

import importlib.util
import io
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[3]
CLIENT_FILES = (
    ROOT / "crm/integrations/python/crm_client.py",
    ROOT / "matchhamin-source/crm_client.py",
)


def load_client(path: Path):
    spec = importlib.util.spec_from_file_location(f"client_{path.parent.name}", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class Response:
    def __init__(self, status: int) -> None:
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False


class DeliveryTests(unittest.TestCase):
    def test_http_failures_never_count_as_delivered(self) -> None:
        for path in CLIENT_FILES:
            with self.subTest(path=path):
                module = load_client(path)
                client = module.CrmClient.__new__(module.CrmClient)
                client.url = "https://crm.example.test/api/v1/events"
                client.source = "test"
                client.api_key = "test-key"
                client.timeout = 1
                event = {"eventId": "evt-1", "type": "integration.healthcheck", "payload": {}}

                for code in (400, 401, 503):
                    with self.subTest(code=code), patch.object(module.urllib.request, "urlopen", side_effect=urllib.error.HTTPError(client.url, code, "error", {}, io.BytesIO())) as send, patch.object(module.time, "sleep"):
                        with self.assertRaises(Exception):
                            client._deliver(event)
                        self.assertEqual(send.call_count, 3 if code == 503 else 1)

                with patch.object(module.urllib.request, "urlopen", return_value=Response(200)):
                    client._deliver(event)

    def test_unavailable_outbox_does_not_fall_back_to_volatile_memory(self) -> None:
        for path in CLIENT_FILES:
            with self.subTest(path=path):
                module = load_client(path)
                with tempfile.TemporaryDirectory() as tmp, patch.object(module.threading.Thread, "start"):
                    file_instead_of_directory = Path(tmp) / "blocked"
                    file_instead_of_directory.write_text("occupied", encoding="utf-8")
                    client = module.CrmClient("https://crm.example.test", "test", "key", outbox_dir=str(file_instead_of_directory))
                    self.assertFalse(client.send("evt-1", "integration.healthcheck", {}))
                    self.assertTrue(client._queue.empty())


if __name__ == "__main__":
    unittest.main()
