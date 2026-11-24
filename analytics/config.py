import os
from dataclasses import dataclass

PROVIDER_PRESETS = {
    "openai": {
        "label": "OpenAI / ChatGPT API",
        "defaultBaseUrl": "https://api.openai.com/v1",
    },
    "google": {
        "label": "Google AI Studio / Gemini",
        "defaultBaseUrl": "https://generativelanguage.googleapis.com/v1beta/openai",
    },
    "openrouter": {
        "label": "OpenRouter",
        "defaultBaseUrl": "https://openrouter.ai/api/v1",
    },
    "avalai": {
        "label": "AvalAI / اول ای‌آی",
        "defaultBaseUrl": "https://api.avalai.ir/v1",
    },
    "gapgpt": {
        "label": "GapGPT / گپ جی‌پی‌تی",
        "defaultBaseUrl": "https://api.gapgpt.app/v1",
    },
    "custom": {"label": "سرویس سازگار با OpenAI", "defaultBaseUrl": ""},
}


@dataclass(frozen=True)
class Settings:
    database_url: str = "sqlite:///./analytics-data/analytics.sqlite"
    internal_token: str = ""
    api_key: str = ""
    provider: str = "openai"
    model: str = ""
    embedding_model: str = ""
    api_base_url: str = ""
    embedding_provider: str = ""
    embedding_api_key: str = ""
    embedding_api_base_url: str = ""
    provider_settings_file: str = "./analytics-data/provider-settings.json"
    environment: str = "development"
    worker_enabled: bool = True
    api_timeout: float = 120
    max_run_records: int = 100_000
    max_prompt_chars: int = 24_000
    max_run_calls: int = 1_000
    max_output_tokens: int = 6_000
    monthly_token_limit: int = 5_000_000
    guides_dir: str = "./analytics-data/guides"

    @classmethod
    def from_env(cls):
        return cls(
            database_url=os.getenv("ANALYTICS_DATABASE_URL", cls.database_url),
            internal_token=os.getenv("ANALYTICS_INTERNAL_TOKEN", ""),
            api_key=os.getenv("ANALYTICS_API_KEY", ""),
            provider=os.getenv("ANALYTICS_PROVIDER", "openai").strip().lower(),
            model=os.getenv("ANALYTICS_MODEL", ""),
            embedding_model=os.getenv("ANALYTICS_EMBEDDING_MODEL", ""),
            api_base_url=os.getenv("ANALYTICS_API_BASE_URL", cls.api_base_url).rstrip(
                "/"
            ),
            embedding_provider=os.getenv("ANALYTICS_EMBEDDING_PROVIDER", "")
            .strip()
            .lower(),
            embedding_api_key=os.getenv("ANALYTICS_EMBEDDING_API_KEY", ""),
            embedding_api_base_url=os.getenv(
                "ANALYTICS_EMBEDDING_API_BASE_URL", ""
            ).rstrip("/"),
            provider_settings_file=os.getenv(
                "ANALYTICS_PROVIDER_SETTINGS_FILE", cls.provider_settings_file
            ),
            environment=os.getenv("ANALYTICS_ENV", "production"),
            worker_enabled=os.getenv("ANALYTICS_WORKER_ENABLED", "true").lower()
            == "true",
            api_timeout=float(os.getenv("ANALYTICS_API_TIMEOUT", "120")),
            max_run_records=int(os.getenv("ANALYTICS_MAX_RUN_RECORDS", "100000")),
            max_prompt_chars=int(os.getenv("ANALYTICS_MAX_PROMPT_CHARS", "24000")),
            max_run_calls=int(os.getenv("ANALYTICS_MAX_RUN_CALLS", "1000")),
            max_output_tokens=int(os.getenv("ANALYTICS_MAX_OUTPUT_TOKENS", "6000")),
            monthly_token_limit=int(
                os.getenv("ANALYTICS_MONTHLY_TOKEN_LIMIT", "5000000")
            ),
            guides_dir=os.getenv("ANALYTICS_GUIDES_DIR", cls.guides_dir),
        )

    @property
    def model_configured(self):
        return bool(
            self.provider in PROVIDER_PRESETS
            and self.api_key
            and self.model
            and self.resolved_api_base_url
        )

    @property
    def embedding_configured(self):
        return bool(
            self.effective_embedding_provider in PROVIDER_PRESETS
            and self.effective_embedding_api_key
            and self.embedding_model
            and self.resolved_embedding_api_base_url
        )

    @property
    def resolved_api_base_url(self):
        return self.api_base_url.rstrip("/") or PROVIDER_PRESETS.get(
            self.provider, {}
        ).get("defaultBaseUrl", "")

    @property
    def effective_embedding_provider(self):
        return self.embedding_provider or self.provider

    @property
    def resolved_embedding_api_base_url(self):
        if self.embedding_api_base_url:
            return self.embedding_api_base_url.rstrip("/")
        if self.effective_embedding_provider == self.provider:
            return self.resolved_api_base_url
        return PROVIDER_PRESETS.get(self.effective_embedding_provider, {}).get(
            "defaultBaseUrl", ""
        )

    @property
    def effective_embedding_api_key(self):
        if self.embedding_api_key:
            return self.embedding_api_key
        if (
            self.effective_embedding_provider == self.provider
            and self.resolved_embedding_api_base_url == self.resolved_api_base_url
        ):
            return self.api_key
        return ""
