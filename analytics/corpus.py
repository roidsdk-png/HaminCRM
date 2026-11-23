import hashlib
import math
import re
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from .contracts import Filters, SyncRequest
from .privacy import redact, redact_text
from .storage import AnalyticsError, Database, dumps, iso, loads, now

TEHRAN = ZoneInfo("Asia/Tehran")
STOPWORDS = set(
    "من تو او ما شما آنها این آن و یا که به از در با برای را رو هم هست است بود شده شد می یه یک خیلی سلام ممنون تشکر لطفا لطفاً باشه بله نه خب خود ولی اما اگر چون تا هر فقط مثلا واقعاً یعنی دارم داری داره کنم کنی کند کنیم نیست میشه هستم هستی خوب".split()
)
TOKEN_RE = re.compile(r"[\w\u200c]+", re.UNICODE)


def normalize(text):
    value = text.replace("ي", "ی").replace("ك", "ک").replace("\u200c", " ")
    value = re.sub("[\u064b-\u065f\u0670]", "", value)
    return " ".join(value.lower().split())


def date_boundary(value, end=False):
    if not value:
        return None
    try:
        date = datetime.strptime(value, "%Y-%m-%d").replace(tzinfo=TEHRAN)
    except ValueError as error:
        raise AnalyticsError(
            "invalid_date", "تاریخ باید به صورت YYYY-MM-DD معتبر باشد."
        ) from error
    return int((date + timedelta(days=1) if end else date).timestamp())


def matches(record, filters: Filters):
    if filters.sourceIds and record["source_id"] not in filters.sourceIds:
        return False
    if filters.kinds and record["kind"] not in filters.kinds:
        return False
    if (
        record["kind"] == "message"
        and filters.roles
        and record["role"] not in filters.roles
    ):
        return False
    lower = date_boundary(filters.from_)
    upper = date_boundary(filters.to, True)
    if lower is not None and upper is not None and lower >= upper:
        raise AnalyticsError("invalid_range", "شروع بازه باید پیش از پایان باشد.")
    if lower is not None and record["occurred_at"] < lower:
        return False
    if upper is not None and record["occurred_at"] >= upper:
        return False
    if filters.contactId and record["contact_id"] != filters.contactId:
        return False
    metadata = record["metadata"]
    if not filters.includeExcluded and metadata.get("countable") is False:
        return False
    demographic = metadata.get("demographics", metadata)
    if filters.gender and demographic.get("gender") != filters.gender:
        return False
    if filters.province and demographic.get("province") != filters.province:
        return False
    age = demographic.get("age")
    if filters.ageFrom is not None and (
        not isinstance(age, (int, float))
        or isinstance(age, bool)
        or not math.isfinite(age)
        or age < filters.ageFrom
    ):
        return False
    if filters.ageTo is not None and (
        not isinstance(age, (int, float))
        or isinstance(age, bool)
        or not math.isfinite(age)
        or age > filters.ageTo
    ):
        return False
    if filters.testKey and metadata.get("testKey") != filters.testKey:
        return False
    if filters.scoreKey:
        score = (metadata.get("scores") or {}).get(filters.scoreKey)
        if (
            not isinstance(score, (int, float))
            or isinstance(score, bool)
            or not math.isfinite(score)
        ):
            return False
        if filters.scoreFrom is not None and score < filters.scoreFrom:
            return False
        if filters.scoreTo is not None and score > filters.scoreTo:
            return False
    return True


def text_units(record):
    if record["kind"] == "message":
        return [("text", record["text"])] if record["text"].strip() else []
    free_text = record["metadata"].get("freeText")
    if isinstance(free_text, str) and free_text.strip():
        return [("freeText", free_text)]
    if isinstance(free_text, list):
        return [
            (f"freeText:{i}", t)
            for i, t in enumerate(free_text)
            if isinstance(t, str) and t.strip()
        ]
    return []


class Corpus:
    def __init__(self, db: Database):
        self.db = db

    def sync(self, body: SyncRequest):
        sequence = body.sequence if body.sequence is not None else int(now() * 1000)
        names = body.redactionNames
        with self.db.connect(write=True) as connection:
            if self.db.postgres:
                connection.execute("SELECT pg_advisory_xact_lock(7284511)")
            active = connection.one(
                "SELECT s.* FROM snapshots s JOIN metadata m ON m.value=s.id WHERE m.key='active_snapshot'"
            )
            snapshot = connection.one(
                "SELECT * FROM snapshots WHERE id=?", (body.snapshotId,)
            )
            if snapshot and snapshot["generation"] != body.generation:
                raise AnalyticsError(
                    "snapshot_conflict", "شناسهٔ نسخه با نسل داده سازگار نیست.", 409
                )
            if snapshot and snapshot["status"] == "committed":
                recorded_count = connection.one(
                    "SELECT value FROM metadata WHERE key=?",
                    ("snapshot-count:" + snapshot["id"],),
                )
                return {
                    "snapshotId": snapshot["id"],
                    "committed": True,
                    "records": int(recorded_count["value"])
                    if recorded_count
                    else self._count(connection, snapshot["id"]),
                    "idempotent": True,
                }
            if active and sequence <= active["sequence"]:
                raise AnalyticsError(
                    "stale_snapshot", "نسخهٔ قدیمی‌تر از دادهٔ فعال پذیرفته نشد.", 409
                )
            if body.mode == "delta" and (
                not active or active["generation"] != body.generation
            ):
                raise AnalyticsError(
                    "baseline_required",
                    "برای این نسل داده ابتدا نسخهٔ کامل لازم است.",
                    409,
                )
            sources = [source.model_dump() for source in body.sources]
            if not snapshot:
                connection.execute(
                    "INSERT INTO snapshots(id,generation,sequence,mode,status,sources,started_at) VALUES (?,?,?,?,?,?,?)",
                    (
                        body.snapshotId,
                        body.generation,
                        sequence,
                        body.mode,
                        "preparing",
                        dumps(sources),
                        now(),
                    ),
                )
                if body.mode == "delta":
                    connection.execute(
                        "INSERT INTO records SELECT ?,id,kind,source_id,contact_id,conversation_id,role,occurred_at,text,metadata,content_hash FROM records WHERE snapshot_id=?",
                        (body.snapshotId, active["id"]),
                    )
                    if not sources:
                        sources = loads(active["sources"], [])
            elif snapshot["mode"] != body.mode or (
                body.sequence is not None and snapshot["sequence"] != sequence
            ):
                raise AnalyticsError(
                    "snapshot_conflict",
                    "پارامترهای نسخه در صفحات باید یکسان باشند.",
                    409,
                )
            if sources:
                connection.execute(
                    "UPDATE snapshots SET sources=? WHERE id=?",
                    (dumps(sources), body.snapshotId),
                )
            connection.execute(
                "UPDATE snapshots SET started_at=? WHERE id=? AND status='preparing'",
                (now(), body.snapshotId),
            )
            for item in body.records:
                text = redact_text(item.text, names)
                metadata = redact(item.metadata, names)
                digest = hashlib.sha256(
                    dumps(
                        {
                            "text": text,
                            "metadata": metadata,
                            "role": item.role,
                            "sourceId": item.sourceId,
                            "contactId": item.contactId,
                            "conversationId": item.conversationId,
                            "occurredAt": item.occurredAt,
                        }
                    ).encode()
                ).hexdigest()
                connection.execute(
                    "INSERT INTO records(snapshot_id,id,kind,source_id,contact_id,conversation_id,role,occurred_at,text,metadata,content_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(snapshot_id,id) DO UPDATE SET kind=excluded.kind,source_id=excluded.source_id,contact_id=excluded.contact_id,conversation_id=excluded.conversation_id,role=excluded.role,occurred_at=excluded.occurred_at,text=excluded.text,metadata=excluded.metadata,content_hash=excluded.content_hash",
                    (
                        body.snapshotId,
                        item.id,
                        item.kind,
                        item.sourceId,
                        item.contactId,
                        item.conversationId,
                        item.role,
                        item.occurredAt,
                        text,
                        dumps(metadata),
                        digest,
                    ),
                )
            for record_id in body.deletedIds:
                connection.execute(
                    "DELETE FROM records WHERE snapshot_id=? AND id=?",
                    (body.snapshotId, record_id),
                )
            if body.complete:
                connection.execute(
                    "INSERT INTO metadata(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                    (
                        "snapshot-count:" + body.snapshotId,
                        str(self._count(connection, body.snapshotId)),
                    ),
                )
                current = connection.one(
                    "SELECT s.* FROM snapshots s JOIN metadata m ON m.value=s.id WHERE m.key='active_snapshot'"
                )
                if current and current["sequence"] >= sequence:
                    raise AnalyticsError(
                        "stale_snapshot",
                        "نسخهٔ تازه‌تری پیش از پایان دریافت فعال شده است.",
                        409,
                    )
                source_ids = {
                    source["id"]
                    for source in loads(
                        connection.one(
                            "SELECT sources FROM snapshots WHERE id=?",
                            (body.snapshotId,),
                        )["sources"],
                        [],
                    )
                }
                rows = connection.all(
                    "SELECT DISTINCT source_id FROM records WHERE snapshot_id=?",
                    (body.snapshotId,),
                )
                if any(row["source_id"] not in source_ids for row in rows):
                    raise AnalyticsError(
                        "unknown_source", "رکوردی با منبع ناشناخته در نسخه وجود دارد."
                    )
                connection.execute(
                    "UPDATE snapshots SET status='committed',finished_at=? WHERE id=?",
                    (now(), body.snapshotId),
                )
                connection.execute(
                    "INSERT INTO metadata(key,value) VALUES ('active_snapshot',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                    (body.snapshotId,),
                )
            return {
                "snapshotId": body.snapshotId,
                "committed": body.complete,
                "records": self._count(connection, body.snapshotId),
            }

    @staticmethod
    def _count(connection, snapshot_id):
        return connection.one(
            "SELECT COUNT(*) count FROM records WHERE snapshot_id=?", (snapshot_id,)
        )["count"]

    def records(self, filters: Filters, snapshot_id=None, *, with_snapshot=False):
        date_boundary(filters.from_)
        date_boundary(filters.to, True)
        if filters.from_ and filters.to and filters.from_ > filters.to:
            raise AnalyticsError("invalid_range", "بازهٔ زمانی نامعتبر است.")
        if (
            filters.ageFrom is not None
            and filters.ageTo is not None
            and filters.ageFrom > filters.ageTo
        ):
            raise AnalyticsError("invalid_range", "بازهٔ سن نامعتبر است.")
        if (
            filters.scoreFrom is not None
            and filters.scoreTo is not None
            and filters.scoreFrom > filters.scoreTo
        ):
            raise AnalyticsError("invalid_range", "بازهٔ نمره نامعتبر است.")
        if (
            filters.scoreFrom is not None or filters.scoreTo is not None
        ) and not filters.scoreKey:
            raise AnalyticsError(
                "invalid_score_filter", "نام مقیاس برای فیلتر نمره لازم است."
            )
        # Resolve the pointer and read its records in one database statement.
        # A sync/retention transaction cannot prune a formerly active corpus
        # between two independent reads and manufacture an empty dashboard.
        selection = (
            "s.id=?"
            if snapshot_id
            else "s.id=(SELECT value FROM metadata WHERE key='active_snapshot')"
        )
        captured = self.db.all(
            "SELECT r.*,s.id AS corpus_id,s.generation AS corpus_generation,s.finished_at AS corpus_finished_at,"
            "CASE WHEN ROW_NUMBER() OVER (ORDER BY r.occurred_at,r.id)=1 THEN s.sources END AS corpus_sources "
            "FROM snapshots s LEFT JOIN records r ON r.snapshot_id=s.id WHERE "
            + selection
            + " ORDER BY r.occurred_at,r.id",
            (snapshot_id,) if snapshot_id else (),
        )
        snapshot = (
            {
                "id": captured[0]["corpus_id"],
                "generation": captured[0]["corpus_generation"],
                "finished_at": captured[0]["corpus_finished_at"],
                "sources": captured[0]["corpus_sources"],
            }
            if captured
            else None
        )
        rows = [row for row in captured if row["id"] is not None]
        for row in rows:
            for field in (
                "corpus_id",
                "corpus_generation",
                "corpus_finished_at",
                "corpus_sources",
            ):
                row.pop(field)
            row["metadata"] = loads(row["metadata"], {})
        if filters.contactId and filters.includeLinkedContacts:
            linked = {
                row["metadata"].get("verifiedIdentityId")
                for row in rows
                if row["contact_id"] == filters.contactId
                and isinstance(row["metadata"].get("verifiedIdentityId"), str)
                and row["metadata"]["verifiedIdentityId"]
            }
            scoped = filters.model_copy(update={"contactId": None})
            result = [
                row
                for row in rows
                if (
                    row["contact_id"] == filters.contactId
                    or row["metadata"].get("verifiedIdentityId") in linked
                )
                and matches(row, scoped)
            ]
        else:
            result = [row for row in rows if matches(row, filters)]
        return (result, snapshot) if with_snapshot else result

    def sources(self):
        active = self.db.active_snapshot()
        return loads(active["sources"], []) if active else []

    def overview(self, filters, settings):
        records, active = self.records(filters, with_snapshot=True)
        messages = [row for row in records if row["kind"] == "message"]
        linked = [
            row
            for row in records
            if isinstance(row["metadata"].get("verifiedIdentityId"), str)
            and row["metadata"]["verifiedIdentityId"].strip()
        ]
        return {
            "dataset": {
                "snapshotId": active["id"],
                "generation": active["generation"],
                "syncedAt": iso(active["finished_at"]),
            }
            if active
            else None,
            "configuration": {
                "modelConfigured": settings.model_configured,
                "embeddingConfigured": settings.embedding_configured,
                "model": settings.model,
                "embeddingModel": settings.embedding_model,
            },
            "totals": {
                "records": len(records),
                "messages": len(messages),
                "userMessages": sum(r["role"] == "user" for r in messages),
                "assistantMessages": sum(r["role"] == "assistant" for r in messages),
                "conversations": len(
                    {
                        (r["source_id"], r["conversation_id"])
                        for r in messages
                        if r["conversation_id"]
                    }
                ),
                "contacts": len(
                    {
                        (r["source_id"], r["contact_id"])
                        for r in records
                        if r["contact_id"]
                    }
                ),
                "tests": sum(r["kind"] == "test" for r in records),
                "matches": sum(r["kind"] == "match" for r in records),
                "verifiedIdentities": len(
                    {row["metadata"]["verifiedIdentityId"] for row in linked}
                ),
                "linkedContacts": len(
                    {
                        (row["source_id"], row["contact_id"])
                        for row in linked
                        if row["contact_id"]
                    }
                ),
            },
            "sources": loads(active["sources"], []) if active else [],
            "coverage": {
                "eligible": len(records),
                "processed": 0,
                "pending": len(records),
                "failed": 0,
            },
            "notice": "پوشش تحلیل معنایی برای هر اجرای ذخیره‌شده جداگانه نمایش داده می‌شود.",
        }

    def words(self, filters, ngram=1, limit=100, metric="conversations"):
        from .administration import lexicon

        vocabulary = lexicon(self.db, STOPWORDS)
        stopwords = set(vocabulary["stopwords"])
        records = self.records(filters)
        occurrence = Counter()
        message_ids = defaultdict(set)
        conversations = defaultdict(set)
        for record in records:
            for _, text in text_units(record):
                tokens = [
                    t
                    for t in TOKEN_RE.findall(normalize(text))
                    if not t.isdigit()
                    and len(t) > 1
                    and t
                    not in {"تلفن", "ایمیل", "پیوند", "شناسه", "شماره", "نام", "نشانی"}
                ]
                terms = [
                    " ".join(tokens[i : i + ngram])
                    for i in range(len(tokens) - ngram + 1)
                    if any(t not in stopwords for t in tokens[i : i + ngram])
                ]
                if ngram == 1:
                    terms = [term for term in terms if term not in stopwords]
                terms = [term for term in terms if term not in stopwords]
                for term in terms:
                    occurrence[term] += 1
                    message_ids[term].add(record["id"])
                    conversations[term].add(
                        (record["source_id"], record["conversation_id"] or record["id"])
                    )
        frequency = {
            "conversations": lambda term: len(conversations[term]),
            "messages": lambda term: len(message_ids[term]),
            "occurrences": lambda term: occurrence[term],
        }[metric]
        terms = sorted(
            occurrence,
            key=lambda term: (-frequency(term), -occurrence[term], term),
        )[:limit]
        return {
            "items": [
                {
                    "term": term,
                    "occurrences": occurrence[term],
                    "messages": len(message_ids[term]),
                    "conversations": len(conversations[term]),
                }
                for term in terms
            ],
            "totalRecords": sum(bool(text_units(r)) for r in records),
            "metric": metric,
            "range": {"from": filters.from_, "to": filters.to},
            "ngram": ngram,
            "lexiconVersion": vocabulary["version"],
        }

    def search(self, filters, query, limit=30, snapshot_id=None):
        tokens = set(TOKEN_RE.findall(normalize(query))) - STOPWORDS
        scored = []
        for record in self.records(filters, snapshot_id):
            normalized = normalize(record["text"] + " " + dumps(record["metadata"]))
            score = sum(normalized.count(token) for token in tokens)
            if score:
                scored.append((score, record))
        scored.sort(key=lambda pair: (-pair[0], pair[1]["id"]))
        return [record for _, record in scored[:limit]]

    def current_record(self, record_id):
        active = self.db.active_snapshot()
        if not active:
            return None
        row = self.db.one(
            "SELECT * FROM records WHERE snapshot_id=? AND id=?",
            (active["id"], record_id),
        )
        if row:
            row["metadata"] = loads(row["metadata"], {})
        return row
