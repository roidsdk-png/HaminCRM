"""Private owner-managed provider configuration; secrets never leave this store."""

import json
import os
import tempfile
from dataclasses import replace
from pathlib import Path
from urllib.parse import urlsplit

from .config import PROVIDER_PRESETS, Settings
from .storage import AnalyticsError

FIELDS = {
    "provider": "provider",
    "model": "model",
    "apiBaseUrl": "api_base_url",
    "apiKey": "api_key",
    "embeddingProvider": "embedding_provider",
    "embeddingModel": "embedding_model",
    "embeddingApiBaseUrl": "embedding_api_base_url",
    "embeddingApiKey": "embedding_api_key",
}


def _invalid(
    message="تنظیمات ارائه‌دهنده معتبر نیست.", code="invalid_provider_settings"
):
    return AnalyticsError(code, message, 400)


def _url(value, provider):
    if not value:
        return ""
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except ValueError as error:
        raise _invalid("نشانی API معتبر نیست.") from error
    if (
        not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or any(c.isspace() or ord(c) < 32 for c in value)
        or parsed.scheme not in {"http", "https"}
        or (
            parsed.scheme == "http"
            and parsed.hostname not in {"localhost", "127.0.0.1", "::1"}
        )
        or port == 0
    ):
        raise _invalid(
            "نشانی API باید HTTPS بدون کلید، نام کاربری یا پارامتر محرمانه باشد. HTTP فقط برای سرویس لوکال مجاز است."
        )
    normalized = value.rstrip("/")
    preset = PROVIDER_PRESETS[provider]["defaultBaseUrl"]
    if provider != "custom" and normalized != preset:
        raise _invalid(
            "برای نشانی واسط یا سفارشی، گزینهٔ «سرویس سازگار با OpenAI» را انتخاب کنید.",
            "provider_url_mismatch",
        )
    return normalized


class ProviderSettingsStore:
    def __init__(self, base_settings: Settings):
        self.path = Path(base_settings.provider_settings_file)
        if (
            base_settings.provider_settings_file == Settings.provider_settings_file
            and base_settings.database_url.startswith("sqlite:///")
        ):
            self.path = (
                Path(base_settings.database_url.removeprefix("sqlite:///")).parent
                / "provider-settings.json"
            )
        self.settings = base_settings
        if self.path.is_file():
            try:
                if self.path.stat().st_size > 100_000:
                    raise ValueError("size")
                data = json.loads(self.path.read_text(encoding="utf-8-sig"))
                if not isinstance(data, dict) or data.get("schemaVersion") != 1:
                    raise ValueError("schema")
                config = data.get("configuration")
                # Persisted configuration goes through the same shape/URL checks.
                self.settings = self.prepare(config, initial=True)
            except (OSError, ValueError, TypeError, AnalyticsError) as error:
                raise AnalyticsError(
                    "provider_configuration_unreadable",
                    "خواندن تنظیمات خصوصی ارائه‌دهنده ممکن نیست. فایل تنظیمات را بررسی کنید؛ محتوای آن را در چت یا گزارش خطا نفرستید.",
                    503,
                ) from error
        else:
            self.settings = self.prepare({}, initial=True)

    def public(self):
        settings = self.settings
        return {
            "provider": settings.provider,
            "model": settings.model,
            "apiBaseUrl": settings.api_base_url,
            "effectiveApiBaseUrl": settings.resolved_api_base_url,
            "apiKeyConfigured": bool(settings.api_key),
            "embeddingProvider": settings.embedding_provider,
            "embeddingModel": settings.embedding_model,
            "embeddingApiBaseUrl": settings.embedding_api_base_url,
            "effectiveEmbeddingApiBaseUrl": settings.resolved_embedding_api_base_url,
            "embeddingApiKeyConfigured": bool(settings.embedding_api_key),
            "embeddingUsesChatKey": bool(
                not settings.embedding_api_key and settings.effective_embedding_api_key
            ),
            "modelConfigured": settings.model_configured,
            "embeddingConfigured": settings.embedding_configured,
            "chatProviders": [
                {"id": key, **value} for key, value in PROVIDER_PRESETS.items()
            ],
        }

    def prepare(self, payload, *, initial=False):
        if not isinstance(payload, dict) or set(payload) - set(FIELDS) - {
            "clearApiKey",
            "clearEmbeddingApiKey",
        }:
            raise _invalid()
        values = {}
        for external, internal in FIELDS.items():
            if external not in payload:
                continue
            value = payload[external]
            maximum = (
                16_000
                if external.endswith("Key")
                and external in {"apiKey", "embeddingApiKey"}
                else 2000
                if external.endswith("Url")
                else 300
            )
            if (
                not isinstance(value, str)
                or len(value) > maximum
                or any(ord(c) < 32 for c in value)
            ):
                raise _invalid()
            value = value.strip()
            if external in {"apiKey", "embeddingApiKey"}:
                if value and (not value.isascii() or any(c.isspace() for c in value)):
                    raise _invalid("فرمت کلید API معتبر نیست.")
                if not value and not initial:
                    continue  # Empty fields preserve existing secrets.
            elif external in {"model", "embeddingModel"} and any(
                c.isspace() for c in value
            ):
                raise _invalid("شناسهٔ مدل باید دقیقاً مطابق پنل ارائه‌دهنده باشد.")
            values[internal] = value
        for flag, field in (
            ("clearApiKey", "api_key"),
            ("clearEmbeddingApiKey", "embedding_api_key"),
        ):
            if flag in payload and type(payload[flag]) is not bool:
                raise _invalid()
            if payload.get(flag):
                if values.get(field):
                    raise _invalid("ورود کلید تازه و حذف کلید را هم‌زمان انتخاب نکنید.")
                values[field] = ""
        candidate = replace(self.settings, **values)
        if candidate.provider not in PROVIDER_PRESETS or (
            candidate.embedding_provider
            and candidate.embedding_provider not in PROVIDER_PRESETS
        ):
            raise _invalid("ارائه‌دهندهٔ انتخاب‌شده پشتیبانی نمی‌شود.")
        candidate = replace(
            candidate,
            api_base_url=_url(candidate.api_base_url, candidate.provider),
            embedding_api_base_url=_url(
                candidate.embedding_api_base_url, candidate.effective_embedding_provider
            ),
        )
        if candidate.provider == "custom" and not candidate.api_base_url:
            raise _invalid("برای سرویس سفارشی، نشانی پایهٔ API لازم است.")
        if (
            candidate.effective_embedding_provider == "custom"
            and not candidate.resolved_embedding_api_base_url
        ):
            raise _invalid("نشانی پایهٔ سرویس بردارسازی سفارشی لازم است.")
        if not initial:
            for before, after, old_key, key_name, clear_name in (
                (
                    (self.settings.provider, self.settings.resolved_api_base_url),
                    (candidate.provider, candidate.resolved_api_base_url),
                    self.settings.api_key,
                    "apiKey",
                    "clearApiKey",
                ),
                (
                    (
                        self.settings.effective_embedding_provider,
                        self.settings.resolved_embedding_api_base_url,
                    ),
                    (
                        candidate.effective_embedding_provider,
                        candidate.resolved_embedding_api_base_url,
                    ),
                    self.settings.embedding_api_key,
                    "embeddingApiKey",
                    "clearEmbeddingApiKey",
                ),
            ):
                if (
                    before != after
                    and old_key
                    and not payload.get(key_name, "").strip()
                    and not payload.get(clear_name)
                ):
                    raise _invalid(
                        "با تغییر ارائه‌دهنده یا نشانی، کلید قبلی منتقل نمی‌شود. کلید مقصد تازه را وارد کنید یا حذف کلید قبلی را انتخاب کنید.",
                        "key_reentry_required",
                    )
        return candidate

    def save(self, candidate):
        configuration = {
            external: getattr(candidate, internal)
            for external, internal in FIELDS.items()
        }
        serialized = json.dumps(
            {"schemaVersion": 1, "configuration": configuration},
            ensure_ascii=False,
            allow_nan=False,
        )
        temporary = None
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            descriptor, temporary = tempfile.mkstemp(
                prefix=".providers-", suffix=".tmp", dir=self.path.parent
            )
            with os.fdopen(descriptor, "w", encoding="utf-8") as output:
                output.write(serialized)
                output.flush()
                os.fsync(output.fileno())
            os.chmod(temporary, 0o600)
            os.replace(temporary, self.path)
        except OSError as error:
            raise AnalyticsError(
                "provider_configuration_write_failed",
                "ذخیرهٔ تنظیمات خصوصی ارائه‌دهنده امکان‌پذیر نیست.",
                503,
            ) from error
        finally:
            if temporary:
                Path(temporary).unlink(missing_ok=True)
        self.settings = candidate
        return candidate
