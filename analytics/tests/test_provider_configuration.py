"""Independent provider-settings acceptance checks; no model requests are made."""

import json
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from analytics.app import create_app
from analytics.config import Settings
from analytics.provider_settings import ProviderSettingsStore
from analytics.storage import AnalyticsError


class ProviderConfigurationAcceptance(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(
            prefix="analysis-provider-settings-"
        )
        self.root = Path(self.temporary.name)
        self.path = self.root / "private-providers.json"
        self.settings = Settings(
            database_url="sqlite:///" + str(self.root / "analytics.sqlite"),
            internal_token="local-test-internal-token",
            worker_enabled=False,
            provider_settings_file=str(self.path),
        )
        self.app = create_app(self.settings)
        self.client = TestClient(self.app)
        self.client.__enter__()
        self.headers = {
            "Authorization": "Bearer local-test-internal-token",
            "X-Analytics-Actor": "synthetic-owner",
        }
        self.no_network = patch(
            "httpx.HTTPTransport.handle_request",
            side_effect=AssertionError("Saving configuration must not call a model"),
        )
        self.no_network.__enter__()

    def tearDown(self):
        self.no_network.__exit__(None, None, None)
        self.client.__exit__(None, None, None)
        self.temporary.cleanup()

    def save(self, **values):
        return self.client.post(
            "/v1/provider-settings", headers=self.headers, json=values
        )

    def public(self):
        response = self.client.get("/v1/provider-settings", headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def configuration(self):
        response = self.client.get("/v1/config", headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def seed_key(self):
        secret = "synthetic-key-do-not-return-123456789"
        response = self.save(provider="openai", model="synthetic-model", apiKey=secret)
        self.assertEqual(response.status_code, 200, response.text)
        return secret

    def test_internal_authentication_is_required_for_read_and_write(self):
        self.assertEqual(self.client.get("/v1/provider-settings").status_code, 401)
        self.assertEqual(
            self.client.post("/v1/provider-settings", json={}).status_code, 401
        )
        self.assertFalse(self.path.exists())

    def test_read_has_provider_choices_without_creating_private_file(self):
        value = self.public()
        self.assertIn("provider", value)
        self.assertIn("apiKeyConfigured", value)
        self.assertFalse(value["apiKeyConfigured"])
        choices = {provider["id"] for provider in value["chatProviders"]}
        self.assertTrue(
            {"openai", "google", "openrouter", "avalai", "gapgpt", "custom"} <= choices
        )
        self.assertFalse(self.path.exists())

    def test_draft_provider_can_be_saved_without_any_key(self):
        response = self.save(provider="google", model="synthetic-gemini")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.public()["provider"], "google")
        self.assertFalse(self.configuration()["modelConfigured"])

    def test_iranian_gateway_configuration_is_private_persistent_and_uses_its_preset(self):
        for provider, base in (
            ("avalai", "https://api.avalai.ir/v1"),
            ("gapgpt", "https://api.gapgpt.app/v1"),
        ):
            with self.subTest(provider=provider):
                secret = "synthetic-" + provider + "-private-key"
                response = self.save(
                    provider=provider, model="synthetic-gateway-model", apiKey=secret,
                    embeddingModel="synthetic-gateway-embedding", embeddingProvider="",
                )
                self.assertEqual(response.status_code, 200, response.text)
                public = self.public()
                self.assertEqual(public["provider"], provider)
                self.assertEqual(public["effectiveApiBaseUrl"], base)
                self.assertEqual(public["effectiveEmbeddingApiBaseUrl"], base)
                self.assertTrue(public["modelConfigured"])
                self.assertTrue(public["embeddingConfigured"])
                self.assertNotIn(secret, json.dumps(public))
                with TestClient(create_app(self.settings)) as second:
                    restored = second.get("/v1/provider-settings", headers=self.headers)
                    self.assertEqual(restored.status_code, 200, restored.text)
                    self.assertEqual(restored.json()["provider"], provider)
                    self.assertEqual(restored.json()["effectiveApiBaseUrl"], base)
                    self.assertTrue(restored.json()["apiKeyConfigured"])
                    self.assertNotIn(secret, restored.text)

    def test_switching_between_iranian_gateways_requires_replacement_or_explicit_clear(self):
        first = "synthetic-avalai-private-key"
        self.assertEqual(self.save(
            provider="avalai", model="synthetic-model", apiKey=first,
        ).status_code, 200)
        rejected = self.save(provider="gapgpt", model="synthetic-model")
        self.assertEqual(rejected.status_code, 400)
        self.assertEqual(rejected.json()["error"]["code"], "key_reentry_required")
        self.assertEqual(self.public()["provider"], "avalai")
        self.assertNotIn(first, rejected.text)
        second = "synthetic-gapgpt-private-key"
        accepted = self.save(provider="gapgpt", apiKey=second)
        self.assertEqual(accepted.status_code, 200, accepted.text)
        self.assertEqual(self.app.state.service.provider.settings.api_key, second)
        cleared = self.save(provider="avalai", clearApiKey=True)
        self.assertEqual(cleared.status_code, 200, cleared.text)
        self.assertEqual(self.public()["provider"], "avalai")
        self.assertFalse(self.public()["apiKeyConfigured"])
        self.assertNotIn(second, json.dumps(self.public()))

    def test_iranian_presets_cannot_send_credentials_to_a_different_gateway(self):
        for provider, wrong_base in (
            ("avalai", "https://api.gapgpt.app/v1"),
            ("gapgpt", "https://api.avalai.ir/v1"),
        ):
            with self.subTest(provider=provider):
                response = self.save(
                    provider=provider, apiBaseUrl=wrong_base,
                    apiKey="synthetic-private-key", model="synthetic-model",
                )
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json()["error"]["code"], "provider_url_mismatch")
                self.assertNotIn("synthetic-private-key", response.text)
        self.assertFalse(self.path.exists())

    def test_secret_is_not_returned_and_private_configuration_survives_restart(self):
        secret = self.seed_key()
        self.assertNotIn(secret, json.dumps(self.public()))
        self.assertNotIn(secret, json.dumps(self.configuration()))
        self.assertTrue(self.public()["apiKeyConfigured"])
        self.assertTrue(self.path.is_file())
        with TestClient(create_app(self.settings)) as second:
            response = second.get("/v1/provider-settings", headers=self.headers)
            self.assertEqual(response.status_code, 200, response.text)
            self.assertTrue(response.json()["apiKeyConfigured"])
            self.assertNotIn(secret, response.text)
            self.assertTrue(
                second.get("/v1/config", headers=self.headers).json()["modelConfigured"]
            )

    def test_blank_or_missing_key_preserves_same_target_key(self):
        secret = self.seed_key()
        for values in ({"model": "another-synthetic"}, {"apiKey": ""}):
            response = self.save(**values)
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(self.app.state.service.provider.settings.api_key, secret)
            self.assertTrue(self.public()["apiKeyConfigured"])

    def test_explicit_clear_does_not_restore_environment_key_on_restart(self):
        self.seed_key()
        response = self.save(clearApiKey=True)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertFalse(self.public()["apiKeyConfigured"])
        self.assertFalse(self.configuration()["modelConfigured"])
        with TestClient(create_app(self.settings)) as second:
            self.assertFalse(
                second.get("/v1/provider-settings", headers=self.headers).json()[
                    "apiKeyConfigured"
                ]
            )

    def test_changed_provider_cannot_reuse_secret_implicitly(self):
        secret = self.seed_key()
        response = self.save(provider="google", model="synthetic-gemini")
        self.assertGreaterEqual(response.status_code, 400, response.text)
        self.assertNotIn(secret, response.text)
        self.assertEqual(self.public()["provider"], "openai")
        self.assertEqual(self.app.state.service.provider.settings.api_key, secret)
        cleared = self.save(
            provider="google", model="synthetic-gemini", clearApiKey=True
        )
        self.assertEqual(cleared.status_code, 200, cleared.text)
        self.assertFalse(self.public()["apiKeyConfigured"])

    def test_changed_endpoint_cannot_receive_retained_secret(self):
        secret = self.seed_key()
        response = self.save(apiBaseUrl="https://another-provider.example/v1")
        self.assertGreaterEqual(response.status_code, 400, response.text)
        self.assertNotIn(secret, response.text)
        self.assertEqual(self.app.state.service.provider.settings.api_key, secret)

    def test_new_provider_and_replacement_secret_are_accepted_atomically(self):
        old = self.seed_key()
        replacement = "synthetic-google-key-987654321"
        response = self.save(
            provider="google", model="synthetic-gemini", apiKey=replacement
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.public()["provider"], "google")
        self.assertEqual(self.app.state.service.provider.settings.api_key, replacement)
        self.assertNotIn(old, response.text)
        self.assertNotIn(replacement, response.text)

    def test_invalid_payloads_never_echo_secret(self):
        secret = "synthetic-invalid-key-do-not-echo-123456789"
        for values in (
            {"provider": "unsupported-provider", "apiKey": secret},
            {"model": {"nested": secret}, "apiKey": secret},
            {"clearApiKey": "yes", "apiKey": secret},
            {"unexpectedSecretField": secret, "apiKey": secret},
        ):
            with self.subTest(fields=sorted(values)):
                response = self.save(**values)
                self.assertGreaterEqual(response.status_code, 400, response.text)
                self.assertNotIn(secret, response.text)

    def test_custom_endpoints_reject_credentials_queries_fragments_and_remote_plain_http(
        self,
    ):
        for url in (
            "https://user:secret@example.org/v1",
            "https://example.org/v1?api_key=secret",
            "https://example.org/v1#key",
            "http://example.org/v1",
            "file:///private/config",
            "https://",
        ):
            with self.subTest(url=url):
                response = self.save(provider="custom", apiBaseUrl=url)
                self.assertGreaterEqual(response.status_code, 400, response.text)
        response = self.save(provider="custom", apiBaseUrl="https://private.example/v1")
        self.assertEqual(response.status_code, 200, response.text)

    def test_same_target_embeddings_can_inherit_main_key(self):
        self.seed_key()
        response = self.save(embeddingModel="synthetic-embedding", embeddingProvider="")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(self.configuration()["embeddingConfigured"])

    def test_separate_embedding_provider_needs_separate_key(self):
        main = self.seed_key()
        response = self.save(
            embeddingProvider="google", embeddingModel="synthetic-google-embedding"
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertFalse(self.configuration()["embeddingConfigured"])
        embedding_secret = "synthetic-separate-embedding-key-123456789"
        response = self.save(embeddingApiKey=embedding_secret)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(self.configuration()["embeddingConfigured"])
        serialized = json.dumps(self.public())
        self.assertNotIn(main, serialized)
        self.assertNotIn(embedding_secret, serialized)

    def test_queued_or_running_work_blocks_configuration_change(self):
        db = self.app.state.service.db
        for status in ("queued", "running"):
            with self.subTest(status=status):
                db.execute(
                    "INSERT INTO runs(id,owner,kind,request,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
                    (status, "synthetic-owner", "research", "{}", status, 1, 1),
                )
                response = self.save(provider="google", model="synthetic-model")
                self.assertEqual(response.status_code, 409, response.text)
                self.assertEqual(response.json()["error"]["code"], "configuration_busy")
                self.assertEqual(self.public()["provider"], "openai")
                db.execute("DELETE FROM runs WHERE id=?", (status,))
        self.assertEqual(self.save(provider="google").status_code, 200)

    def test_environment_provider_cannot_use_another_vendors_endpoint(self):
        with self.assertRaises(AnalyticsError):
            ProviderSettingsStore(
                replace(
                    self.settings,
                    provider="google",
                    api_base_url="https://api.openai.com/v1",
                    api_key="synthetic-google-key",
                )
            )

    def test_implicit_default_private_file_follows_isolated_sqlite_database(self):
        local = replace(
            self.settings, provider_settings_file=Settings.provider_settings_file
        )
        store = ProviderSettingsStore(local)
        self.assertEqual(store.path, self.root / "provider-settings.json")
        self.assertFalse(store.path.exists())

    def test_disk_write_failure_preserves_previous_configuration_and_key(self):
        secret = self.seed_key()
        previous = self.path.read_bytes()
        store = self.app.state.service.provider_settings
        candidate = store.prepare({"model": "new-model"})
        with patch(
            "analytics.provider_settings.os.replace",
            side_effect=OSError("synthetic failure"),
        ):
            with self.assertRaises(AnalyticsError):
                store.save(candidate)
        self.assertEqual(self.path.read_bytes(), previous)
        self.assertEqual(store.settings.api_key, secret)
        self.assertNotEqual(store.settings.model, "new-model")
        self.assertEqual(list(self.root.glob(".providers-*.tmp")), [])

    def test_embedding_destination_change_requires_new_explicit_key(self):
        self.seed_key()
        self.assertEqual(
            self.save(
                embeddingProvider="google",
                embeddingApiKey="synthetic-google-embedding-key",
                embeddingModel="embedding-model",
            ).status_code,
            200,
        )
        failed = self.save(embeddingProvider="openrouter")
        self.assertEqual(failed.status_code, 400)
        self.assertEqual(failed.json()["error"]["code"], "key_reentry_required")
        self.assertEqual(
            self.save(
                embeddingProvider="openrouter", clearEmbeddingApiKey=True
            ).status_code,
            200,
        )
        self.assertFalse(self.configuration()["embeddingConfigured"])


if __name__ == "__main__":
    unittest.main()
