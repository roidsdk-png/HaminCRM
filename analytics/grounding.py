"""Validate numerical claims against computed results and quoted evidence."""

import math
import re
from decimal import Decimal, InvalidOperation

from .storage import AnalyticsError

DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")
NUMBER = re.compile(r"[-+]?\d+(?:[,.٫٬]\d+)*")


def number(value):
    text = (
        str(value).translate(DIGITS).replace("٬", "").replace(",", "").replace("٫", ".")
    )
    try:
        result = Decimal(text)
        return result if result.is_finite() else None
    except InvalidOperation:
        return None


def numbers(text):
    normalized = text.translate(DIGITS).replace("−", "-")
    normalized = re.sub(
        r"\\?\[(?:(?:message|test|match):)?(?:[a-f0-9]{40}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\\?\]",
        "",
        normalized,
    )
    normalized = re.sub(r"(?m)^\s*\d+[.)]\s+", "", normalized)
    return {number(match.group()) for match in NUMBER.finditer(normalized)} - {None}


def validate_numeric_claims(
    answer, numeric_claims, calculations, statistics, evidence_texts
):
    def reject():
        raise AnalyticsError(
            "invalid_numeric_claim",
            "اعداد پاسخ با محاسبات و شواهد همین تحقیق تطبیق ندارند.",
            502,
        )

    numeric_claims = [] if numeric_claims is None else numeric_claims
    if not isinstance(numeric_claims, list):
        reject()
    allowed = set()
    for text in evidence_texts:
        allowed.update(numbers(text))
    root = {"calculations": calculations, "statistics": statistics}
    for claim in numeric_claims:
        if (
            not isinstance(claim, dict)
            or set(claim) != {"value", "path"}
            or not isinstance(claim.get("path"), str)
        ):
            reject()
        value = claim.get("value")
        if (
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not math.isfinite(value)
        ):
            reject()
        parts = claim["path"].split(".")
        if not parts or parts[0] not in root or len(parts) > 10:
            reject()
        resolved = root
        for part in parts:
            if isinstance(resolved, dict) and part in resolved:
                resolved = resolved[part]
            elif (
                isinstance(resolved, list)
                and part.isdecimal()
                and int(part) < len(resolved)
            ):
                resolved = resolved[int(part)]
            else:
                reject()
        if (
            isinstance(resolved, bool)
            or not isinstance(resolved, (int, float))
            or number(resolved) != number(value)
        ):
            reject()
        allowed.add(number(value))
    if not numbers(answer).issubset(allowed):
        reject()
