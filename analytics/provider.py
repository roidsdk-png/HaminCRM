"""The only boundary allowed to send CRM-derived text to a model provider."""

import hashlib
import json
import math
import time
import uuid
from datetime import UTC, datetime
from urllib.parse import urlsplit

import httpx

from .config import PROVIDER_PRESETS
from .privacy import redact
from .storage import AnalyticsError, Database, dumps, loads, now


class Provider:
    def __init__(self, settings, db: Database):
        self.settings = settings
        self.db = db

    def require_model(self):
        self._require_model(self.settings)

    @staticmethod
    def _require_model(settings):
        if not settings.model_configured:
            raise AnalyticsError(
                "model_not_configured",
                "کلید API و مدل تحلیل هنوز تنظیم نشده‌اند. آمار واقعی و ابر واژه قابل استفاده‌اند.",
                503,
            )

    @staticmethod
    def _route(settings, embedding=False):
        provider = (
            settings.effective_embedding_provider if embedding else settings.provider
        )
        base_url = (
            settings.resolved_embedding_api_base_url
            if embedding
            else settings.resolved_api_base_url
        )
        key = settings.effective_embedding_api_key if embedding else settings.api_key
        if provider not in {"openai", "google", "openrouter", "custom"}:
            raise AnalyticsError(
                "invalid_provider_configuration", "ارائه‌دهندهٔ مدل معتبر نیست.", 422
            )
        try:
            parsed = urlsplit(base_url)
            if parsed.port is not None and not 1 <= parsed.port <= 65535:
                raise ValueError("Invalid port")
        except ValueError as error:
            raise AnalyticsError(
                "invalid_provider_configuration", "نشانی API معتبر نیست.", 422
            ) from error
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.hostname
            or parsed.username
            or parsed.password
            or parsed.query
            or parsed.fragment
            or any(ord(char) < 33 for char in base_url)
            or parsed.scheme == "http"
            and parsed.hostname not in {"localhost", "127.0.0.1", "::1"}
        ):
            raise AnalyticsError(
                "invalid_provider_configuration",
                "نشانی API معتبر نیست. از HTTPS یا نشانی HTTP محلی استفاده کنید.",
                422,
            )
        if (
            provider != "custom"
            and base_url.rstrip("/") != PROVIDER_PRESETS[provider]["defaultBaseUrl"]
        ):
            raise AnalyticsError(
                "invalid_provider_configuration",
                "نشانی API با ارائه‌دهنده مطابقت ندارد. برای واسط، سرویس سفارشی را انتخاب کنید.",
                422,
            )
        return provider, base_url.rstrip("/"), key

    @staticmethod
    def _redacted_payload(payload):
        # This second redaction covers prompts, follow-ups, metadata and tool output.
        payload = dict(payload)
        if "input" in payload:
            payload["input"] = redact(payload["input"])
        if "messages" in payload:
            messages = []
            for original in payload["messages"]:
                message = dict(original)
                if "content" in message:
                    message["content"] = redact(message["content"])
                if message.get("tool_calls"):
                    message["tool_calls"] = [
                        dict(
                            call,
                            function={
                                **call["function"],
                                "arguments": redact(
                                    call["function"].get("arguments", "{}")
                                ),
                            },
                        )
                        for call in message["tool_calls"]
                    ]
                messages.append(message)
            payload["messages"] = messages
        return payload

    def _budget(self, settings, payload, run_id, month):
        if run_id:
            calls = self.db.one(
                "SELECT COUNT(*) total FROM usage WHERE run_id=?", (run_id,)
            )
            if calls["total"] >= settings.max_run_calls:
                raise AnalyticsError(
                    "run_budget_exceeded",
                    "تعداد فراخوانی‌های این اجرا به سقف تنظیم‌شده رسیده است.",
                    429,
                )
        usage = self.db.one(
            "SELECT COALESCE(SUM(input_tokens+output_tokens),0) total FROM usage WHERE month=?",
            (month,),
        )
        estimate = math.ceil(len(dumps(payload)) / 2) + payload.get(
            "max_completion_tokens", payload.get("max_tokens", 0)
        )
        if usage["total"] + estimate > settings.monthly_token_limit:
            raise AnalyticsError(
                "budget_exceeded",
                "سقف مصرف ماهانهٔ تحلیل رسیده است. بودجه را در تنظیمات سرور بررسی کنید.",
                429,
            )

    @staticmethod
    def _usage(result):
        usage = result.get("usage")
        if usage is None:
            return 0, 0, False
        if not isinstance(usage, dict):
            raise AnalyticsError(
                "invalid_provider_response", "گزارش مصرف سرویس مدل معتبر نیست.", 502
            )
        for field in ("prompt_tokens", "completion_tokens", "total_tokens"):
            value = usage.get(field)
            if value is not None and (
                type(value) is not int or not 0 <= value <= 1_000_000_000_000
            ):
                raise AnalyticsError(
                    "invalid_provider_response", "گزارش مصرف سرویس مدل معتبر نیست.", 502
                )
        output = usage.get("completion_tokens", 0) or 0
        input_tokens = usage.get("prompt_tokens")
        total = usage.get("total_tokens")
        if input_tokens is None:
            input_tokens = max(0, total - output) if total is not None else 0
        return input_tokens, output, bool(usage)

    def _request(
        self, endpoint, payload, run_id=None, *, settings=None, embedding=False
    ):
        # One immutable configuration is used for model, endpoint, credentials,
        # budgets and retries even if the owner changes the live settings.
        settings = settings or self.settings
        if not embedding:
            self._require_model(settings)
        _, base_url, api_key = self._route(settings, embedding)
        if not api_key:
            raise AnalyticsError(
                "model_not_configured", "کلید API ارائه‌دهنده تنظیم نشده است.", 503
            )
        payload = self._redacted_payload(payload)
        month = datetime.now(UTC).strftime("%Y-%m")
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        with httpx.Client(
            timeout=settings.api_timeout, follow_redirects=False, trust_env=False
        ) as client:
            for attempt in range(3):
                self._budget(settings, payload, run_id, month)
                usage_id = str(uuid.uuid4())
                # Failed attempts also count toward the maximum request count.
                # Unknown token usage stays unknown rather than becoming invented statistics.
                self.db.execute(
                    "INSERT INTO usage(id,month,run_id,model,input_tokens,output_tokens,created_at) VALUES (?,?,?,?,?,?,?)",
                    (usage_id, month, run_id, payload["model"], 0, 0, now()),
                )
                self.db.execute(
                    "INSERT INTO metadata(key,value) VALUES (?,?)",
                    ("usage-unreported:" + usage_id, "true"),
                )
                try:
                    response = client.post(
                        base_url + "/" + endpoint,
                        headers=headers,
                        json=payload,
                    )
                except httpx.RequestError as error:
                    if attempt < 2:
                        time.sleep(2**attempt)
                        continue
                    raise AnalyticsError(
                        "provider_unavailable",
                        "ارتباط با سرویس مدل برقرار نشد. امکان تلاش مجدد وجود دارد.",
                        503,
                    ) from error
                if response.status_code == 429 or response.status_code >= 500:
                    if attempt < 2:
                        time.sleep(2**attempt)
                        continue
                if not response.is_success:
                    raise AnalyticsError(
                        "provider_error",
                        f"سرویس مدل پاسخ معتبر نداد (HTTP {response.status_code}). تنظیمات مدل و سهمیه را بررسی کنید.",
                        502,
                    )
                try:
                    result = response.json()
                except ValueError as error:
                    raise AnalyticsError(
                        "invalid_provider_response",
                        "پاسخ سرویس مدل JSON معتبر نیست.",
                        502,
                    ) from error
                if not isinstance(result, dict) or result.get("error"):
                    raise AnalyticsError(
                        "invalid_provider_response",
                        "ساختار پاسخ سرویس مدل معتبر نیست.",
                        502,
                    )
                input_tokens, output_tokens, reported = self._usage(result)
                self.db.execute(
                    "UPDATE usage SET input_tokens=?,output_tokens=? WHERE id=?",
                    (input_tokens, output_tokens, usage_id),
                )
                if reported:
                    self.db.execute(
                        "DELETE FROM metadata WHERE key=?",
                        ("usage-unreported:" + usage_id,),
                    )
                return result

    def complete(self, messages, run_id=None, tools=None):
        settings = self.settings
        payload = {
            "model": settings.model,
            "messages": messages,
            "max_completion_tokens"
            if settings.provider == "openai"
            else "max_tokens": settings.max_output_tokens,
        }
        if tools:
            payload["tools"] = tools
            payload["tool_choice"] = "auto"
        else:
            payload["response_format"] = {"type": "json_object"}
        result = self._request("chat/completions", payload, run_id, settings=settings)
        try:
            choice = result["choices"][0]
            if choice.get("finish_reason") == "length":
                raise AnalyticsError(
                    "model_output_truncated",
                    "خروجی مدل به سقف طول رسید. دامنه یا طول درخواست را کم کنید یا سقف خروجی را تغییر دهید.",
                    422,
                )
            message = choice["message"]
            if (
                not isinstance(message, dict)
                or message.get("role", "assistant") != "assistant"
            ):
                raise TypeError("Expected assistant message")
            if message.get("content") is not None and not isinstance(
                message["content"], str
            ):
                raise TypeError("Expected text content")
            message = {"role": "assistant", **message}
            if message.get("tool_calls") is not None:
                calls = message["tool_calls"]
                if (
                    not isinstance(calls, list)
                    or len(calls) > 100
                    or any(
                        not isinstance(call, dict)
                        or not isinstance(call.get("function"), dict)
                        or not isinstance(call["function"].get("name"), str)
                        or not isinstance(call["function"].get("arguments", "{}"), str)
                        for call in calls
                    )
                ):
                    raise TypeError("Expected function calls")
            if not message.get("content") and not message.get("tool_calls"):
                raise AnalyticsError(
                    "empty_model_response",
                    "مدل پاسخ متنی یا فراخوانی ابزار قابل استفاده برنگرداند. مدل، سهمیه و محدودیت‌های ارائه‌دهنده را بررسی کنید.",
                    502,
                )
            return message
        except (KeyError, IndexError, TypeError, AttributeError) as error:
            raise AnalyticsError(
                "invalid_provider_response", "ساختار پاسخ مدل قابل استفاده نیست.", 502
            ) from error

    def json(self, system, data, run_id=None):
        message = self.complete(
            [
                {"role": "system", "content": system},
                {"role": "user", "content": dumps(data)},
            ],
            run_id,
        )
        try:
            raw = message.get("content", "").strip()
            if raw.startswith("```"):
                raw = raw.split("\n", 1)[1].rsplit("```", 1)[0].strip()
            result = json.loads(raw)
            if not isinstance(result, dict):
                raise ValueError("Expected object")
            return result
        except (ValueError, AttributeError, IndexError, TypeError) as error:
            raise AnalyticsError(
                "invalid_model_output", "خروجی مدل با قرارداد تحلیل سازگار نیست.", 502
            ) from error

    def embed(self, text, run_id=None):
        settings = self.settings
        if not settings.embedding_configured:
            return None
        provider, base_url, api_key = self._route(settings, embedding=True)
        text = redact(text)
        key = hashlib.sha256(
            dumps(
                [
                    provider,
                    base_url,
                    settings.embedding_model,
                    hashlib.sha256(api_key.encode()).hexdigest(),
                    text,
                ]
            ).encode()
        ).hexdigest()
        cached = self.db.one(
            "SELECT vector_json FROM embeddings WHERE cache_key=?", (key,)
        )
        if cached:
            try:
                vector = loads(cached["vector_json"])
                if self._valid_vector(vector):
                    return vector
            except (ValueError, TypeError):
                pass
        result = self._request(
            "embeddings",
            {"model": settings.embedding_model, "input": text},
            run_id,
            settings=settings,
            embedding=True,
        )
        try:
            vector = result["data"][0]["embedding"]
            if not self._valid_vector(vector):
                raise ValueError("Bad vector")
        except (KeyError, IndexError, TypeError, ValueError) as error:
            raise AnalyticsError(
                "invalid_embedding", "بردار جست‌وجوی مدل معتبر نیست.", 502
            ) from error
        self.db.execute(
            "INSERT INTO embeddings(cache_key,model,vector_json) VALUES (?,?,?) ON CONFLICT(cache_key) DO UPDATE SET vector_json=excluded.vector_json",
            (key, settings.embedding_model, dumps(vector)),
        )
        if self.db.vector_available:
            self.db.execute(
                "UPDATE embeddings SET vector_value=?::vector WHERE cache_key=?",
                (dumps(vector), key),
            )
        return vector

    @staticmethod
    def _valid_vector(vector):
        try:
            return (
                isinstance(vector, list)
                and 0 < len(vector) <= 65_536
                and all(
                    type(value) in (int, float) and math.isfinite(value)
                    for value in vector
                )
                and any(value != 0 for value in vector)
            )
        except (ValueError, TypeError, OverflowError):
            return False
