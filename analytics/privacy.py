"""Redaction is applied before persistence and again at the provider boundary."""

import re
import unicodedata
from typing import Any

SENSITIVE_KEYS = re.compile(
    r"(?:password|secret|token|credential|api.?key|phone|email|address|ip.?hash|"
    r"external.?user.?id|anonymous.?id|contact.?info|username|tracking.?code|"
    r"full.?name|first.?name|last.?name)",
    re.I,
)
PERSIAN_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")
PATTERNS = [
    (re.compile(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}", re.I), "[ایمیل]"),
    (re.compile(r"https?://\S+|www\.\S+", re.I), "[پیوند]"),
    (re.compile(r"(?<!\w)@[\w\u0600-\u06ff.-]+"), "[شناسه]"),
    (
        re.compile(
            r"(?<!\d)(?:\+?98[\s().-]*)?(?:0[\s().-]*)?9(?:[\s().-]*\d){9}(?!\d)"
        ),
        "[تلفن]",
    ),
    (re.compile(r"(?<!\d)\d(?:[ -]*\d){9,19}(?!\d)"), "[شماره]"),
    (re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b"), "[نشانی شبکه]"),
    (
        re.compile(
            r"(?:نام(?:\s+و\s+نام\s+خانوادگی)?(?:\s+من)?|اسمم|اسم\s+من)\s*(?:است|هست|[:=])?\s+[\u0600-\u06ff]+(?:\s+[\u0600-\u06ff]+){0,2}"
        ),
        "[نام]",
    ),
    (re.compile(r"(?:آدرس|نشانی|کد\s*پستی)\s*[:=]\s*[^\n.!؟]+"), "[نشانی]"),
    (
        re.compile(
            r"(?:من|همسرم|مادرم|پدرم|خواهرم|برادرم|دوستم)\s+([\u0600-\u06ff]+(?:\s+[\u0600-\u06ff]+)?)\s+(?:هستم|است|هست|نام\s+دارد|نام\s+داره)"
        ),
        "[فرد]",
    ),
    (
        re.compile(
            r"(?:خیابان|کوچه|بلوار)\s+[^\n.!؟]{0,120}(?:پلاک|واحد)\s*\d+(?:\s*[,،]?\s*واحد\s*\d+)?"
        ),
        "[نشانی]",
    ),
]


def redact_text(text: str, names: list[str] | None = None) -> str:
    value = (
        unicodedata.normalize("NFKC", str(text))
        .translate(PERSIAN_DIGITS)
        .replace("ي", "ی")
        .replace("ك", "ک")
    )
    for name in sorted(set(names or []), key=len, reverse=True):
        name = (
            unicodedata.normalize("NFKC", name)
            .strip()
            .replace("ي", "ی")
            .replace("ك", "ک")
        )
        if len(name) >= 2:
            value = re.sub(
                r"(?<!\w)" + re.escape(name) + r"(?!\w)", "[نام]", value, flags=re.I
            )
    for pattern, replacement in PATTERNS:
        value = pattern.sub(replacement, value)
    return value


def redact(value: Any, names: list[str] | None = None) -> Any:
    if isinstance(value, str):
        return redact_text(value, names)
    if isinstance(value, list):
        return [redact(item, names) for item in value]
    if isinstance(value, dict):
        return {
            key: redact(item, names)
            for key, item in value.items()
            if not SENSITIVE_KEYS.search(key) and key.lower() != "name"
        }
    return value
