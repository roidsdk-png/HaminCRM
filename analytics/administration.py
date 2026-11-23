"""Local owner-managed configuration. Model credentials remain environment-only."""

import hashlib
import json
import os
import tempfile
from pathlib import Path

from .guides import _validated, guide_catalog, load_guides
from .storage import AnalyticsError, dumps, loads


def lexicon(db, defaults):
    row = db.one("SELECT value FROM metadata WHERE key='word-lexicon'")
    words = loads(row["value"]) if row else sorted(defaults)
    version = hashlib.sha256(dumps(words).encode()).hexdigest()[:16]
    return {"stopwords": words, "version": version}


def save_lexicon(db, words):
    from .corpus import normalize

    normalized = sorted({normalize(word).strip() for word in words if word.strip()})
    db.execute(
        "INSERT INTO metadata(key,value) VALUES('word-lexicon',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (dumps(normalized),),
    )
    return lexicon(db, ())


def _managed_path(directory, key, version):
    digest = hashlib.sha256(f"{key}\0{version}".encode()).hexdigest()
    return Path(directory) / f"managed-{digest}.json"


def save_guide(directory, value, confirmed):
    guide = _validated(value)
    if (
        not confirmed
        or not guide
        or not any(
            guide.get(field) for field in ("scales", "scoring", "interpretation")
        )
    ):
        raise AnalyticsError(
            "invalid_guide",
            "راهنمای معتبر باید شناسه، نسخه، مرجع و تعریف مقیاس، نمره‌گذاری یا تفسیر داشته باشد و تأیید شود.",
        )
    serialized = json.dumps(guide, ensure_ascii=False, sort_keys=True, allow_nan=False)
    if len(serialized.encode()) > 120_000:
        raise AnalyticsError("guide_too_large", "حجم راهنما بیش از حد مجاز است.", 413)
    path = _managed_path(directory, guide["testKey"], guide["version"])
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.exists():
            previous = json.loads(path.read_text(encoding="utf-8"))
            if previous != guide:
                raise AnalyticsError(
                    "guide_version_conflict",
                    "این نسخه قبلاً ثبت شده است. نسخهٔ تازه ثبت کنید یا تعریف قبلی را صریحاً حذف کنید.",
                    409,
                )
        if path.exists():
            return guide_catalog(load_guides(directory))
        handle, temporary = tempfile.mkstemp(
            prefix=".guide-", suffix=".tmp", dir=path.parent
        )
        try:
            with os.fdopen(handle, "w", encoding="utf-8") as output:
                output.write(serialized)
            try:
                os.link(temporary, path)
            except FileExistsError as error:
                if json.loads(path.read_text(encoding="utf-8")) != guide:
                    raise AnalyticsError(
                        "guide_version_conflict",
                        "این نسخه هم‌زمان تغییر کرده است. تعریف ثبت‌شده را بازبینی کنید.",
                        409,
                    ) from error
        finally:
            Path(temporary).unlink(missing_ok=True)
    except OSError as error:
        raise AnalyticsError(
            "guide_storage_failed", "ذخیرهٔ راهنما در مسیر تنظیم‌شده امکان‌پذیر نیست.", 503
        ) from error
    return guide_catalog(load_guides(directory))


def delete_guide(directory, key, version):
    path = _managed_path(directory, key, version)
    if not path.is_file():
        raise AnalyticsError(
            "guide_not_found",
            "راهنمای ثبت‌شده از رابط پیدا نشد. فایل‌های پیکربندی محلی از همین مسیر حذف نمی‌شوند.",
            404,
        )
    try:
        path.unlink()
    except OSError as error:
        raise AnalyticsError(
            "guide_storage_failed", "حذف راهنما امکان‌پذیر نیست.", 503
        ) from error
    return guide_catalog(load_guides(directory))
