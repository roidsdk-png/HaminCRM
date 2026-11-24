"""Provider contracts use synthetic transports, never live API keys or network calls."""

import json
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

import httpx

from analytics.config import Settings
from analytics.provider import Provider
from analytics.storage import AnalyticsError, Database


def response(message=None, **extra):
    return {
        "choices": [
            {
                "message": message
                or {"role": "assistant", "content": '{"answer":"synthetic"}'}
            }
        ],
        "usage": {"prompt_tokens": 9, "completion_tokens": 4, "total_tokens": 13},
        **extra,
    }


class ProviderContracts(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="crm-provider-contract-")
        self.db = Database("sqlite:///" + str(Path(self.temp.name) / "data.sqlite"))
        self.settings = Settings(
            api_key="synthetic-chat-key",
            model="synthetic-model",
            embedding_model="synthetic-embedding",
        )
        self.provider = Provider(self.settings, self.db)

    def tearDown(self):
        self.temp.cleanup()

    def transport(self, value, status=200):
        return patch(
            "analytics.provider.httpx.Client.post",
            return_value=httpx.Response(
                status,
                content=json.dumps(value).encode(),
                headers={"content-type": "application/json"},
            ),
        )

    def test_provider_presets_route_chat_json_and_generation_cap(self):
        for provider, base, cap in (
            ("openai", "https://api.openai.com/v1", "max_completion_tokens"),
            (
                "google",
                "https://generativelanguage.googleapis.com/v1beta/openai",
                "max_tokens",
            ),
            ("openrouter", "https://openrouter.ai/api/v1", "max_tokens"),
            ("avalai", "https://api.avalai.ir/v1", "max_tokens"),
            ("gapgpt", "https://api.gapgpt.app/v1", "max_tokens"),
        ):
            with self.subTest(provider=provider):
                self.provider.settings = replace(self.settings, provider=provider)
                with self.transport(response()) as post:
                    result = self.provider.json("Return JSON", {"query": "synthetic"})
                self.assertEqual(result, {"answer": "synthetic"})
                self.assertEqual(post.call_args.args[0], base + "/chat/completions")
                sent = post.call_args.kwargs
                self.assertEqual(
                    sent["headers"]["Authorization"], "Bearer synthetic-chat-key"
                )
                self.assertEqual(sent["json"][cap], self.settings.max_output_tokens)
                other_cap = (
                    "max_tokens"
                    if cap == "max_completion_tokens"
                    else "max_completion_tokens"
                )
                self.assertNotIn(other_cap, sent["json"])
                self.assertEqual(
                    sent["json"]["response_format"], {"type": "json_object"}
                )

    def test_custom_endpoint_is_explicit_and_not_silently_openai(self):
        self.provider.settings = replace(
            self.settings,
            provider="custom",
            api_base_url="https://synthetic.example/v1/",
        )
        with self.transport(response()) as post:
            self.provider.complete([{"role": "user", "content": "Synthetic"}])
        self.assertEqual(
            post.call_args.args[0], "https://synthetic.example/v1/chat/completions"
        )
        self.provider.settings = replace(self.settings, provider="custom")
        with self.transport(response()) as post:
            with self.assertRaises(AnalyticsError):
                self.provider.complete([])
        post.assert_not_called()

    def test_named_provider_cannot_forward_its_key_to_custom_endpoint(self):
        self.provider.settings = replace(
            self.settings, api_base_url="https://synthetic.example/openai"
        )
        with self.transport(response()) as post:
            with self.assertRaises(AnalyticsError):
                self.provider.complete([])
        post.assert_not_called()

    def test_gemini_tools_preserve_opaque_signatures_and_redact_only_text(self):
        self.provider.settings = replace(self.settings, provider="google")
        signature = "opaque-signature-123456789012345678901234567890"
        tool_reply = {
            "role": "assistant",
            "content": None,
            "tool_calls": [
                {
                    "id": "call-one",
                    "type": "function",
                    "function": {
                        "name": "get_statistics",
                        "arguments": '{"query":"ali@example.org"}',
                    },
                    "extra_content": {"google": {"thought_signature": signature}},
                }
            ],
        }
        tool = {
            "type": "function",
            "function": {
                "name": "get_statistics",
                "parameters": {"type": "object", "properties": {}},
            },
        }
        with self.transport(response(tool_reply)):
            returned = self.provider.complete(
                [{"role": "user", "content": "synthetic"}], tools=[tool]
            )
        self.assertEqual(returned, tool_reply)
        messages = [
            {"role": "user", "content": "با 09121234567 تماس بگیر"},
            returned,
            {
                "role": "tool",
                "tool_call_id": "call-one",
                "content": '{"email":"ali@example.org","count":2}',
            },
        ]
        original = json.dumps(messages)
        with self.transport(response()) as post:
            self.provider.complete(messages, tools=[tool])
        sent = post.call_args.kwargs["json"]
        self.assertEqual(
            sent["messages"][1]["tool_calls"][0]["extra_content"]["google"][
                "thought_signature"
            ],
            signature,
        )
        self.assertEqual(sent["tools"], [tool])
        self.assertEqual(sent["tool_choice"], "auto")
        self.assertNotIn("response_format", sent)
        self.assertNotIn("09121234567", json.dumps(sent))
        self.assertNotIn("ali@example.org", json.dumps(sent))
        self.assertEqual(json.dumps(messages), original)

    def test_all_provider_embedding_presets_use_supported_compatibility_endpoint(self):
        for provider, base in (
            ("openai", "https://api.openai.com/v1"),
            ("google", "https://generativelanguage.googleapis.com/v1beta/openai"),
            ("openrouter", "https://openrouter.ai/api/v1"),
            ("avalai", "https://api.avalai.ir/v1"),
            ("gapgpt", "https://api.gapgpt.app/v1"),
        ):
            with self.subTest(provider=provider):
                self.provider.settings = replace(self.settings, provider=provider)
                with self.transport(
                    {"data": [{"embedding": [0.25, 0.5]}], "usage": {"total_tokens": 3}}
                ) as post:
                    self.assertEqual(
                        self.provider.embed("synthetic " + provider), [0.25, 0.5]
                    )
                self.assertEqual(post.call_args.args[0], base + "/embeddings")
                self.assertEqual(
                    post.call_args.kwargs["json"]["model"], "synthetic-embedding"
                )
                self.assertEqual(
                    post.call_args.kwargs["headers"]["Authorization"],
                    "Bearer synthetic-chat-key",
                )

    def test_iranian_gateway_tools_round_trip_uses_gateway_and_redacts_text(self):
        tool = {
            "type": "function",
            "function": {
                "name": "get_statistics",
                "parameters": {"type": "object", "properties": {}},
            },
        }
        reply = {
            "role": "assistant",
            "content": None,
            "tool_calls": [{
                "id": "synthetic-tool-call",
                "type": "function",
                "function": {"name": "get_statistics", "arguments": "{}"},
            }],
        }
        for provider, base in (
            ("avalai", "https://api.avalai.ir/v1"),
            ("gapgpt", "https://api.gapgpt.app/v1"),
        ):
            with self.subTest(provider=provider):
                self.provider.settings = replace(self.settings, provider=provider)
                with self.transport(response(reply)) as post:
                    result = self.provider.complete(
                        [{"role": "user", "content": "ali@example.org"}],
                        tools=[tool],
                    )
                self.assertEqual(result, reply)
                self.assertEqual(post.call_args.args[0], base + "/chat/completions")
                sent = post.call_args.kwargs["json"]
                self.assertEqual(sent["tools"], [tool])
                self.assertEqual(sent["tool_choice"], "auto")
                self.assertNotIn("response_format", sent)
                self.assertNotIn("ali@example.org", json.dumps(sent))
                with self.transport(response()) as post:
                    self.provider.complete([
                        result,
                        {"role": "tool", "tool_call_id": "synthetic-tool-call",
                         "content": '{"count":2,"email":"ali@example.org"}'},
                    ], tools=[tool])
                sent = post.call_args.kwargs["json"]
                self.assertEqual(sent["messages"][0]["tool_calls"], reply["tool_calls"])
                self.assertNotIn("ali@example.org", json.dumps(sent))

    def test_iranian_embedding_provider_does_not_receive_the_other_gateways_key(self):
        for chat, embedding, base in (
            ("avalai", "gapgpt", "https://api.gapgpt.app/v1"),
            ("gapgpt", "avalai", "https://api.avalai.ir/v1"),
        ):
            with self.subTest(chat=chat, embedding=embedding):
                self.provider.settings = replace(
                    self.settings, provider=chat, embedding_provider=embedding,
                )
                self.assertFalse(self.provider.settings.embedding_configured)
                with self.transport({}) as post:
                    self.assertIsNone(self.provider.embed("synthetic isolated input"))
                post.assert_not_called()
                self.provider.settings = replace(
                    self.provider.settings, embedding_api_key="synthetic-embedding-only-key",
                )
                with self.transport({"data": [{"embedding": [0.25, 0.5]}]}) as post:
                    self.assertEqual(
                        self.provider.embed("synthetic isolated input"), [0.25, 0.5]
                    )
                self.assertEqual(post.call_args.args[0], base + "/embeddings")
                self.assertEqual(
                    post.call_args.kwargs["headers"]["Authorization"],
                    "Bearer synthetic-embedding-only-key",
                )

    def test_embedding_can_use_a_separate_provider_and_key_without_chat(self):
        self.provider.settings = replace(
            self.settings,
            api_key="",
            model="",
            embedding_provider="google",
            embedding_api_key="synthetic-gemini-key",
        )
        self.assertTrue(self.provider.settings.embedding_configured)
        with self.transport({"data": [{"embedding": [0.25, 0.5]}]}) as post:
            self.provider.embed("synthetic isolated embedding")
        self.assertEqual(
            post.call_args.kwargs["headers"]["Authorization"],
            "Bearer synthetic-gemini-key",
        )
        self.assertEqual(
            post.call_args.args[0],
            "https://generativelanguage.googleapis.com/v1beta/openai/embeddings",
        )

    def test_chat_credential_never_leaks_to_different_embedding_provider_or_endpoint(
        self,
    ):
        for changes in (
            {"embedding_provider": "google"},
            {"embedding_api_base_url": "https://different.example/v1"},
        ):
            with self.subTest(changes=changes):
                self.provider.settings = replace(self.settings, **changes)
                self.assertFalse(self.provider.settings.embedding_configured)
                with self.transport({}) as post:
                    self.assertIsNone(self.provider.embed("synthetic"))
                post.assert_not_called()

    def test_embedding_cache_is_bound_to_provider_endpoint_model_and_account(self):
        changes = [
            {},
            {"provider": "google"},
            {"provider": "avalai"},
            {"provider": "gapgpt"},
            {"provider": "custom", "api_base_url": "https://other.example/v1"},
            {"embedding_model": "other-embedding"},
            {"api_key": "synthetic-new-account"},
        ]
        with self.transport({"data": [{"embedding": [0.25, 0.5]}]}) as post:
            for change in changes:
                self.provider.settings = replace(self.settings, **change)
                self.provider.embed("same synthetic text")
                self.provider.embed("same synthetic text")
        self.assertEqual(post.call_count, len(changes))
        serialized = str(self.db.all("SELECT cache_key,vector_json FROM embeddings"))
        self.assertNotIn("synthetic-chat-key", serialized)
        self.assertNotIn("synthetic-new-account", serialized)

    def test_invalid_vectors_are_rejected_including_booleans_zero_and_nonfinite(self):
        for number, vector in enumerate(
            (
                [True, 0.5],
                [],
                [0, 0],
                [float("nan")],
                [float("inf")],
                ["0.5"],
                {"value": 0.25},
            )
        ):
            with (
                self.subTest(vector=vector),
                self.transport({"data": [{"embedding": vector}]}),
            ):
                with self.assertRaises(AnalyticsError) as error:
                    self.provider.embed("synthetic bad vector " + str(number))
                self.assertEqual(error.exception.code, "invalid_embedding")
        self.assertEqual(self.db.one("SELECT COUNT(*) n FROM embeddings")["n"], 0)

    def test_cache_corruption_is_replaced_by_a_valid_embedding(self):
        with self.transport({"data": [{"embedding": [0.25, 0.5]}]}) as post:
            self.provider.embed("synthetic cache corruption")
            self.db.execute("UPDATE embeddings SET vector_json='[true,0.5]'")
            self.provider.embed("synthetic cache corruption")
            self.provider.embed("synthetic cache corruption")
        self.assertEqual(post.call_count, 2)

    def test_runtime_setting_switch_cannot_mix_request_or_retry_credentials(self):
        calls = []
        changed = replace(
            self.settings,
            provider="google",
            model="different-model",
            api_key="different-key",
        )

        def post(url, **kwargs):
            calls.append((url, kwargs))
            self.provider.settings = changed
            return (
                httpx.Response(500, json={})
                if len(calls) == 1
                else httpx.Response(200, json=response())
            )

        with (
            patch("analytics.provider.httpx.Client.post", side_effect=post),
            patch("analytics.provider.time.sleep"),
        ):
            self.provider.complete([])
            self.provider.complete([])
        for url, sent in calls[:2]:
            self.assertEqual(url, "https://api.openai.com/v1/chat/completions")
            self.assertEqual(
                sent["headers"]["Authorization"], "Bearer synthetic-chat-key"
            )
            self.assertEqual(sent["json"]["model"], "synthetic-model")
        self.assertIn("generativelanguage.googleapis.com", calls[2][0])
        self.assertEqual(
            calls[2][1]["headers"]["Authorization"], "Bearer different-key"
        )

    def test_retry_attempts_cannot_bypass_per_run_request_limit(self):
        self.provider.settings = replace(self.settings, max_run_calls=1)
        with (
            self.transport({}, status=429) as post,
            patch("analytics.provider.time.sleep"),
        ):
            with self.assertRaises(AnalyticsError) as error:
                self.provider.complete([], run_id="synthetic-run")
        self.assertEqual(error.exception.code, "run_budget_exceeded")
        self.assertEqual(post.call_count, 1)
        self.assertEqual(self.db.one("SELECT COUNT(*) n FROM usage")["n"], 1)

    def test_monthly_budget_is_checked_before_sending_a_request(self):
        self.provider.settings = replace(self.settings, monthly_token_limit=1)
        with self.transport(response()) as post:
            with self.assertRaises(AnalyticsError) as error:
                self.provider.complete([])
        self.assertEqual(error.exception.code, "budget_exceeded")
        post.assert_not_called()

    def test_malformed_usage_returns_safe_error_without_provider_body_or_key(self):
        for usage in (
            [1],
            {"prompt_tokens": True},
            {"completion_tokens": -1},
            {"total_tokens": "secret-provider-debug"},
            {"total_tokens": float("nan")},
            {"prompt_tokens": 10**20},
        ):
            with self.subTest(usage=usage), self.transport(response(usage=usage)):
                with self.assertRaises(AnalyticsError) as error:
                    self.provider.complete([])
                self.assertEqual(error.exception.code, "invalid_provider_response")
                self.assertNotIn("secret-provider-debug", str(error.exception))
                self.assertNotIn(self.settings.api_key, str(error.exception))

    def test_missing_usage_remains_flagged_and_is_not_invented(self):
        result = response()
        del result["usage"]
        with self.transport(result):
            self.provider.complete([])
        usage = self.db.one("SELECT * FROM usage")
        self.assertEqual((usage["input_tokens"], usage["output_tokens"]), (0, 0))
        self.assertEqual(
            self.db.one(
                "SELECT value FROM metadata WHERE key=?",
                ("usage-unreported:" + usage["id"],),
            )["value"],
            "true",
        )

    def test_token_usage_total_is_not_double_counted(self):
        with self.transport(
            response(usage={"total_tokens": 13, "completion_tokens": 4})
        ):
            self.provider.complete([])
        usage = self.db.one("SELECT * FROM usage")
        self.assertEqual((usage["input_tokens"], usage["output_tokens"]), (9, 4))
        self.assertEqual(
            self.db.one(
                "SELECT COUNT(*) n FROM metadata WHERE key LIKE ?",
                ("usage-unreported:%",),
            )["n"],
            0,
        )

    def test_invalid_http_payloads_and_messages_are_rejected(self):
        for value in (
            [],
            {"error": {"message": "sensitive body"}},
            {"choices": []},
            response(message={"role": "user", "content": "bad role"}),
            response(message={"content": []}),
            response(message={"content": None}),
            response(message={"content": None, "tool_calls": [{}]}),
        ):
            with self.subTest(value=value), self.transport(value):
                with self.assertRaises(AnalyticsError):
                    self.provider.complete([])

    def test_truncated_model_output_is_not_accepted_as_complete_analysis(self):
        value = response()
        value["choices"][0]["finish_reason"] = "length"
        with self.transport(value):
            with self.assertRaises(AnalyticsError) as error:
                self.provider.complete([])
        self.assertEqual(error.exception.code, "model_output_truncated")

    def test_credential_in_url_and_unsafe_plain_http_are_rejected(self):
        for url in (
            "https://user:secret@example.test/v1",
            "http://example.test/v1",
            "https://example.test/v1?api_key=secret",
            "https://example.test/v1#secret",
            "https://[",
            "https://example.test:bad/v1",
        ):
            with self.subTest(url=url):
                self.provider.settings = replace(self.settings, api_base_url=url)
                with self.transport(response()) as post:
                    with self.assertRaises(AnalyticsError):
                        self.provider.complete([])
                post.assert_not_called()


if __name__ == "__main__":
    unittest.main()
