import json
import secrets
import uuid
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from threading import RLock
from typing import Literal

from fastapi import Depends, FastAPI, Header, Query, Request
from fastapi.responses import JSONResponse

from .administration import delete_guide, lexicon, save_guide, save_lexicon
from .config import Settings
from .contracts import (
    ContentRequest,
    Filters,
    GuideRequest,
    LexiconRequest,
    MessageRequest,
    RunRequest,
    SessionRequest,
    SyncRequest,
)
from .corpus import STOPWORDS, Corpus, normalize
from .guides import guide_catalog, load_guides
from .jobs import Jobs
from .provider import Provider
from .provider_settings import ProviderSettingsStore
from .retention import cleanup_snapshots
from .storage import AnalyticsError, Database, dumps, iso, loads, now


class Service:
    def __init__(self, settings):
        self.provider_settings = ProviderSettingsStore(settings)
        settings = self.provider_settings.settings
        self.settings = settings
        self.configuration_lock = RLock()
        self.db = Database(settings.database_url)
        self.corpus = Corpus(self.db)
        self.provider = Provider(settings, self.db)
        self.jobs = Jobs(settings, self.db, self.corpus, self.provider)

    def configuration(self):
        month = datetime.now(UTC).strftime("%Y-%m")
        usage = self.db.one(
            "SELECT COUNT(*) AS calls,COALESCE(SUM(input_tokens),0) AS input_tokens,COALESCE(SUM(output_tokens),0) AS output_tokens FROM usage WHERE month=?",
            (month,),
        )
        return {
            "serviceConfigured": True,
            "modelConfigured": self.settings.model_configured,
            "embeddingConfigured": self.settings.embedding_configured,
            "model": self.settings.model,
            "provider": self.settings.provider,
            "embeddingProvider": self.settings.effective_embedding_provider,
            "embeddingModel": self.settings.embedding_model,
            "limits": {
                "monthlyTokens": self.settings.monthly_token_limit,
                "maxRunRecords": self.settings.max_run_records,
                "maxRunCalls": self.settings.max_run_calls,
            },
            "usage": {
                "month": month,
                "inputTokens": usage["input_tokens"],
                "outputTokens": usage["output_tokens"],
                "calls": usage["calls"],
                "unreportedCalls": self.db.one(
                    "SELECT COUNT(*) total FROM usage u JOIN metadata m ON m.key='usage-unreported:'||u.id WHERE u.month=?",
                    (month,),
                )["total"],
            },
        }


def create_app(settings: Settings | None = None):
    settings = settings or Settings.from_env()
    service = Service(settings)

    @asynccontextmanager
    async def lifespan(application):
        if settings.worker_enabled:
            service.jobs.start()
        yield
        service.jobs.stop()

    app = FastAPI(
        title="CRM private analytics",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        lifespan=lifespan,
    )
    app.state.service = service

    @app.exception_handler(AnalyticsError)
    async def handle_error(request, error):
        return JSONResponse(
            status_code=error.status,
            content={"error": {"code": error.code, "message": error.message}},
        )

    @app.middleware("http")
    async def cache_headers(request, call_next):
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    def actor(
        authorization: str | None = Header(default=None),
        x_analytics_actor: str | None = Header(default=None),
    ):
        if not settings.internal_token:
            raise AnalyticsError(
                "service_not_configured", "توکن داخلی سرویس تحلیل تنظیم نشده است.", 503
            )
        expected = f"Bearer {settings.internal_token}"
        if not authorization or not secrets.compare_digest(
            authorization.encode(), expected.encode()
        ):
            raise AnalyticsError("unauthorized", "دسترسی معتبر لازم است.", 401)
        if (
            not x_analytics_actor
            or len(x_analytics_actor) > 300
            or any(ord(c) < 32 for c in x_analytics_actor)
        ):
            raise AnalyticsError("unauthorized", "شناسهٔ مدیر معتبر لازم است.", 401)
        return x_analytics_actor

    def filters(request: Request):
        data = {}
        if request.query_params.get("filters"):
            try:
                data = json.loads(request.query_params["filters"])
            except ValueError as error:
                raise AnalyticsError(
                    "invalid_filters", "ساختار فیلتر معتبر نیست."
                ) from error
        else:
            for field in (
                "from",
                "to",
                "sourceIds",
                "kinds",
                "roles",
                "contactId",
                "includeLinkedContacts",
                "gender",
                "province",
                "ageFrom",
                "ageTo",
                "testKey",
                "scoreKey",
                "scoreFrom",
                "scoreTo",
                "includeExcluded",
            ):
                value = request.query_params.get(field)
                if value is not None:
                    data[field] = (
                        value.split(",")
                        if field in {"sourceIds", "kinds", "roles"}
                        else value
                    )
        try:
            return Filters.model_validate(data)
        except ValueError as error:
            raise AnalyticsError(
                "invalid_filters", "مقادیر فیلتر معتبر نیستند."
            ) from error

    @app.get("/health")
    def health():
        service.db.one("SELECT 1 AS ok")
        return {"status": "ok", "service": "crm-analytics"}

    @app.post("/v1/sync")
    def sync(body: SyncRequest, owner=Depends(actor)):
        result = service.corpus.sync(body)
        if result["committed"]:
            cleanup_snapshots(service.db)
        return result

    @app.get("/v1/config")
    def config(owner=Depends(actor)):
        return service.configuration()

    @app.get("/v1/provider-settings")
    def provider_settings(owner=Depends(actor)):
        with service.configuration_lock:
            return service.provider_settings.public()

    @app.post("/v1/provider-settings")
    async def update_provider_settings(request: Request, owner=Depends(actor)):
        raw = await request.body()
        if len(raw) > 100_000:
            raise AnalyticsError(
                "request_too_large", "حجم تنظیمات بیش از حد مجاز است.", 413
            )
        try:
            payload = json.loads(raw)
        except (ValueError, UnicodeError) as error:
            raise AnalyticsError(
                "invalid_provider_settings", "ساختار تنظیمات معتبر نیست.", 400
            ) from error
        with service.configuration_lock:
            if service.db.one(
                "SELECT COUNT(*) total FROM runs WHERE status IN ('queued','running')"
            )["total"]:
                raise AnalyticsError(
                    "configuration_busy",
                    "برای تغییر اتصال مدل، ابتدا تحلیل‌های در حال اجرا را متوقف کنید یا تا پایان آن‌ها صبر کنید.",
                    409,
                )
            candidate = service.provider_settings.prepare(payload)
            service.provider_settings.save(candidate)
            service.settings = candidate
            service.provider.settings = candidate
            service.jobs.settings = candidate
            return service.provider_settings.public()

    @app.get("/v1/lexicon")
    def get_lexicon(owner=Depends(actor)):
        return lexicon(service.db, STOPWORDS)

    @app.post("/v1/lexicon")
    def update_lexicon(body: LexiconRequest, owner=Depends(actor)):
        return save_lexicon(service.db, body.stopwords)

    @app.get("/v1/guides")
    def get_guides(owner=Depends(actor)):
        return guide_catalog(load_guides(settings.guides_dir))

    @app.post("/v1/guides")
    def update_guide(body: GuideRequest, owner=Depends(actor)):
        return save_guide(settings.guides_dir, body.guide, body.confirmed)

    @app.delete("/v1/guides")
    def remove_guide(
        testKey: str = Query(min_length=1, max_length=500),
        version: str = Query(min_length=1, max_length=500),
        owner=Depends(actor),
    ):
        return delete_guide(settings.guides_dir, testKey, version)

    @app.get("/v1/catalog")
    def catalog(owner=Depends(actor)):
        active = service.db.active_snapshot()
        return {
            "sources": service.corpus.sources(),
            "configuration": service.configuration(),
            "fields": [
                "sourceId",
                "kind",
                "role",
                "occurredAt",
                "contactId",
                "demographics",
                "testKey",
                "scores",
                "answers",
                "result",
                "guide",
            ],
            "recordKinds": ["message", "test", "match"],
            "identityPolicy": "شناسهٔ مخاطب در محدودهٔ منبع تفسیر می‌شود. اتصال فردی بین منابع به نگاشت تأییدشده نیاز دارد.",
            "sync": {
                "snapshotId": active["id"],
                "lastSyncedAt": iso(active["finished_at"]),
                "changeSequence": active["sequence"],
            }
            if active
            else {},
            "notice": "منشأ پیام مخاطب، پاسخ ربات، سؤال آزمون و تحلیل مدل در دادهٔ تحلیلی حفظ می‌شود.",
        }

    @app.get("/v1/overview")
    def overview(selected: Filters = Depends(filters), owner=Depends(actor)):
        return service.corpus.overview(selected, service.settings)

    @app.get("/v1/words")
    def words(
        selected: Filters = Depends(filters),
        owner=Depends(actor),
        ngram: int = Query(default=1, ge=1, le=3),
        limit: int = Query(default=100, ge=1, le=500),
        metric: Literal["conversations", "messages", "occurrences"] = "conversations",
    ):
        return service.corpus.words(selected, ngram, limit, metric)

    @app.get("/v1/word-evidence")
    def word_evidence(
        term: str = Query(min_length=1, max_length=300),
        selected: Filters = Depends(filters),
        owner=Depends(actor),
        limit: int = Query(default=5, ge=1, le=100),
    ):
        active = service.db.active_snapshot()
        if not active:
            return {"items": []}
        run_id = str(uuid.uuid4())
        timestamp = now()
        service.db.execute(
            "INSERT INTO runs(id,owner,kind,request,snapshot_id,status,progress,created_at,updated_at) VALUES (?,?,?,?,?,'completed',100,?,?)",
            (
                run_id,
                owner,
                "evidence",
                dumps({"internal": "word-evidence"}),
                active["id"],
                timestamp,
                timestamp,
            ),
        )
        row = service.jobs.row(owner, run_id)
        output = []
        from .corpus import text_units

        for record in service.corpus.records(selected):
            for field, text in text_units(record):
                if normalize(term) in normalize(text):
                    output.append(
                        service.jobs.save_evidence(
                            row,
                            record,
                            field,
                            text[:1200] if len(text) <= 1200 else _excerpt(text, term),
                        )
                    )
                    break
            if len(output) >= limit:
                break
        return {"items": output}

    @app.post("/v1/runs")
    def create_run(body: RunRequest, owner=Depends(actor)):
        with service.configuration_lock:
            return service.jobs.create(owner, body)

    @app.get("/v1/runs")
    def list_runs(owner=Depends(actor)):
        rows = service.db.all(
            "SELECT id,request FROM runs WHERE owner=? AND kind <> 'evidence' ORDER BY created_at DESC,id LIMIT 1000",
            (owner,),
        )
        visible = [
            row
            for row in rows
            if loads(row["request"], {}).get("kind")
            in {"research", "challenges", "emotions", "experiences", "content"}
        ][:100]
        return {"items": [service.jobs.get(owner, row["id"]) for row in visible]}

    @app.get("/v1/runs/{run_id}")
    def get_run(run_id: str, owner=Depends(actor)):
        return service.jobs.get(owner, run_id)

    @app.delete("/v1/runs/{run_id}")
    def cancel_run(run_id: str, owner=Depends(actor)):
        return service.jobs.cancel(owner, run_id)

    @app.get("/v1/result-sets/{result_set_id}/items")
    def result_page(
        result_set_id: str,
        cursor: str | None = None,
        limit: int = Query(default=3, ge=1, le=1000),
        owner=Depends(actor),
    ):
        return service.jobs.result_page(owner, result_set_id, cursor, limit)

    @app.get("/v1/evidence/{evidence_id}")
    def evidence(evidence_id: str, owner=Depends(actor)):
        return service.jobs.evidence(owner, evidence_id)

    @app.post("/v1/sessions")
    def create_session(body: SessionRequest, owner=Depends(actor)):
        return service.jobs.create_session(owner, body.title)

    @app.get("/v1/sessions")
    def sessions(owner=Depends(actor)):
        return service.jobs.sessions(owner)

    @app.get("/v1/sessions/{session_id}")
    def session(session_id: str, owner=Depends(actor)):
        return service.jobs.session(owner, session_id)

    @app.post("/v1/sessions/{session_id}/messages")
    def message(session_id: str, body: MessageRequest, owner=Depends(actor)):
        with service.configuration_lock:
            return service.jobs.message(owner, session_id, body)

    @app.post("/v1/content")
    def content(body: ContentRequest, owner=Depends(actor)):
        request = RunRequest(
            kind="content",
            query=body.prompt,
            filters=body.filters,
            evidenceIds=body.evidenceIds,
            format=body.format,
            tone=body.tone,
            length=body.length,
            sessionId=body.sessionId,
        )
        with service.configuration_lock:
            return service.jobs.create(owner, request)

    return app


def _excerpt(text, term):
    # A source-index map preserves exact quotes after Persian normalization.
    normalized = []
    positions = []
    for index, character in enumerate(text):
        if character.isspace() or character == "\u200c":
            if normalized and normalized[-1] != " ":
                normalized.append(" ")
                positions.append(index)
            continue
        for letter in normalize(character):
            normalized.append(letter)
            positions.append(index)
    needle = normalize(term)
    import re

    # Whitespace and ZWNJ can represent the same phrase in the word cloud.
    pattern = r"[\s\u200c]+".join(re.escape(part) for part in needle.split())
    match = re.search(pattern, "".join(normalized))
    position = positions[match.start()] if match else 0
    start = max(0, position - 200)
    return text[start : start + 1200]


app = create_app()
