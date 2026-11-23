"""Deterministic cohort selection and statistics within an authorized corpus."""

import math
import re
from collections import defaultdict
from datetime import datetime

from .corpus import TEHRAN, normalize
from .storage import AnalyticsError

DIRECT_FIELDS = {
    "sourceId": "source_id",
    "kind": "kind",
    "role": "role",
    "contactId": "contact_id",
    "occurredAt": "occurred_at",
}
DEMOGRAPHIC_FIELDS = {"gender", "province", "city", "age", "education"}
SCORE_FIELD = re.compile(r"scores\.[\w\u200c-]{1,100}\Z", re.UNICODE)
OPERATORS = {"eq", "ne", "in", "gte", "lte", "contains"}
METRICS = {"count", "distinctContacts", "sum", "average", "min", "max"}


def _error(message):
    raise AnalyticsError("invalid_research_spec", message, 422)


def _field(field, allow_day=False):
    if not isinstance(field, str):
        _error("نام فیلد تحقیق باید رشته باشد.")
    if field in DIRECT_FIELDS or field in {"testKey", "verifiedIdentityId"}:
        return field
    if (
        field.startswith("demographics.")
        and field.partition(".")[2] in DEMOGRAPHIC_FIELDS
    ):
        return field
    if SCORE_FIELD.fullmatch(field):
        return field
    if field == "day" and allow_day:
        return field
    _error("فیلد تحقیق در فهرست داده‌های مجاز قرار ندارد.")


def _numeric_field(field):
    return field in {"occurredAt", "demographics.age"} or field.startswith("scores.")


def _number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    try:
        return math.isfinite(value)
    except OverflowError:
        return False


def _value(record, field):
    if field in DIRECT_FIELDS:
        return record.get(DIRECT_FIELDS[field])
    metadata = record.get("metadata") or {}
    if not isinstance(metadata, dict):
        return None
    if field in {"testKey", "verifiedIdentityId"}:
        return metadata.get(field)
    if field == "day":
        timestamp = record.get("occurred_at")
        if not _number(timestamp):
            return None
        try:
            return datetime.fromtimestamp(timestamp, TEHRAN).date().isoformat()
        except (OverflowError, OSError, ValueError):
            return None
    parent, _, key = field.partition(".")
    values = metadata.get(parent) or {}
    return values.get(key) if isinstance(values, dict) else None


def _scalar(value):
    return isinstance(value, (str, bool)) or _number(value)


def _equal(left, right, normalized_text=False):
    if normalized_text and isinstance(left, str) and isinstance(right, str):
        return normalize(left) == normalize(right)
    if isinstance(left, bool) or isinstance(right, bool):
        return type(left) is type(right) and left == right
    return left == right


def _condition(spec):
    if not isinstance(spec, dict) or set(spec) != {"field", "operator", "value"}:
        _error("هر شرط باید فیلد، عملگر و مقدار مشخص داشته باشد.")
    field = _field(spec["field"])
    operator = spec["operator"]
    value = spec["value"]
    if not isinstance(operator, str) or operator not in OPERATORS:
        _error("عملگر شرط تحقیق معتبر نیست.")
    if operator == "in":
        if not isinstance(value, list) or not value or len(value) > 100:
            _error("مقدار عملگر in باید فهرست غیرخالی با حداکثر صد عضو باشد.")
        valid = all(
            _number(item) if _numeric_field(field) else _scalar(item) for item in value
        )
    else:
        valid = _number(value) if _numeric_field(field) else _scalar(value)
    if not valid:
        _error("نوع مقدار شرط با فیلد تحقیق سازگار نیست.")
    if operator in {"gte", "lte"} and not _numeric_field(field):
        _error("مقایسهٔ عددی فقط روی فیلد عددی مجاز است.")
    if operator == "contains" and (
        _numeric_field(field) or not isinstance(value, str) or not value.strip()
    ):
        _error("جست‌وجوی بخشی از مقدار به فیلد متنی و عبارت غیرخالی نیاز دارد.")
    return field, operator, value


def _matches(record, condition):
    field, operator, expected = condition
    actual = _value(record, field)
    if (
        actual is None
        or not _scalar(actual)
        or (_numeric_field(field) and not _number(actual))
    ):
        return False
    normalized_text = field.startswith("demographics.")
    if operator == "eq":
        return _equal(actual, expected, normalized_text)
    if operator == "ne":
        return not _equal(actual, expected, normalized_text)
    if operator == "in":
        return any(_equal(actual, item, normalized_text) for item in expected)
    if operator == "gte":
        return actual >= expected
    if operator == "lte":
        return actual <= expected
    return isinstance(actual, str) and normalize(expected) in normalize(actual)


def apply_attempt_policy(records, policy="all"):
    """Collapse completed test attempts before applying score conditions.

    Missing contacts or test keys stay separate. Same-source contact identity
    is used for deduplication, never guessed cross-source identity.
    """
    if not isinstance(policy, str) or policy not in {"all", "latest_per_contact"}:
        _error("قاعدهٔ انتخاب تلاش آزمون معتبر نیست.")
    rows = list(records)
    eligible = sum(record["kind"] == "test" for record in rows)
    if policy == "all":
        return rows, {
            "attemptPolicy": policy,
            "eligibleAttempts": eligible,
            "consideredAttempts": eligible,
        }
    latest = {}
    retained = []
    for record in rows:
        if record["kind"] != "test":
            retained.append(record)
            continue
        metadata = record.get("metadata") or {}
        status = metadata.get("status")
        if metadata.get("completed") is False or (
            isinstance(status, str)
            and status in {"pending", "started", "in_progress", "incomplete"}
        ):
            continue
        source, contact, key = (
            record.get("source_id"),
            record.get("contact_id"),
            metadata.get("testKey"),
        )
        if not source or not contact or not isinstance(key, str) or not key:
            retained.append(record)
            continue
        identity = (source, contact, key)
        stamp = record.get("occurred_at")
        order = (stamp if _number(stamp) else float("-inf"), record["id"])
        if identity not in latest or order > latest[identity][0]:
            latest[identity] = (order, record)
    retained_ids = {record["id"] for record in retained} | {
        row[1]["id"] for row in latest.values()
    }
    result = [record for record in rows if record["id"] in retained_ids]
    return result, {
        "attemptPolicy": policy,
        "eligibleAttempts": eligible,
        "consideredAttempts": sum(record["kind"] == "test" for record in result),
    }


def attempt_selection_summary(records, base_summary):
    tests = [record for record in records if record["kind"] == "test"]
    known = {
        (record["source_id"], record["contact_id"])
        for record in tests
        if record.get("source_id") and record.get("contact_id")
    }
    unknown = sum(
        not record.get("source_id") or not record.get("contact_id") for record in tests
    )
    return {
        **base_summary,
        "selectedAttempts": len(tests),
        "selectedParticipants": len(known),
        "unidentifiedSelectedAttempts": unknown,
    }


def select_records(records, conditions, attempt_policy="all"):
    """Return the original records matching all approved conditions.

    The caller supplies the already authorized scope. Missing values never match
    a condition, including ``ne``. Numeric strings and booleans are excluded from
    numeric comparisons. Text matching normalizes Persian character variants.
    """
    if not isinstance(conditions, list) or len(conditions) > 100:
        _error("شرط‌های تحقیق باید فهرست با حداکثر صد شرط باشند.")
    compiled = [_condition(condition) for condition in conditions]
    records, _ = apply_attempt_policy(records, attempt_policy)
    return [
        record
        for record in records
        if all(_matches(record, condition) for condition in compiled)
    ]


def _summary(records, metric, field):
    eligible = len(records)
    if metric == "count":
        return {
            "eligible": eligible,
            "measured": eligible,
            "missing": 0,
            "value": eligible,
        }
    if metric == "distinctContacts":
        present = [
            record
            for record in records
            if record.get("contact_id") and record.get("source_id")
        ]
        contacts = {(record["source_id"], record["contact_id"]) for record in present}
        return {
            "eligible": eligible,
            "measured": len(present),
            "missing": eligible - len(present),
            "value": len(contacts),
        }
    values = [_value(record, field) for record in records]
    numeric = [value for value in values if _number(value)]
    value = None
    if numeric:
        try:
            if metric in {"sum", "average"}:
                value = (
                    sum(numeric)
                    if all(isinstance(item, int) for item in numeric)
                    else math.fsum(numeric)
                )
                if metric == "average":
                    value /= len(numeric)
            elif metric == "min":
                value = min(numeric)
            else:
                value = max(numeric)
        except (OverflowError, ValueError):
            _error("نتیجهٔ محاسبه از دامنهٔ عددی پشتیبانی‌شده خارج است.")
        if not _number(value):
            _error("نتیجهٔ محاسبه عدد متناهی نیست.")
    return {
        "eligible": eligible,
        "measured": len(numeric),
        "missing": eligible - len(numeric),
        "value": value,
    }


def _group_key(record, field):
    value = _value(record, field)
    if value is None or not _scalar(value):
        return None
    if _numeric_field(field) and not _number(value):
        return None
    return value


def _sort_group(value):
    if value is None:
        return (2, "")
    if _number(value):
        return (0, value)
    return (1, str(value))


def aggregate_records(records, spec):
    """Aggregate an authorized cohort with explicit missing-data denominators."""
    if not isinstance(spec, dict) or set(spec) - {"groupBy", "metric", "field"}:
        _error("ساختار محاسبهٔ تحقیق معتبر نیست.")
    metric = spec.get("metric", "count")
    if not isinstance(metric, str) or metric not in METRICS:
        _error("نوع محاسبهٔ تحقیق معتبر نیست.")
    group_by = spec.get("groupBy")
    if group_by is not None:
        group_by = _field(group_by, allow_day=True)
    field = spec.get("field")
    if metric in {"sum", "average", "min", "max"}:
        field = _field(field)
        if not _numeric_field(field):
            _error("این محاسبه به فیلد عددی مجاز نیاز دارد.")
    elif field is not None:
        _error("شمارش رکورد و مخاطب به فیلد عددی نیاز ندارند.")
    selected = list(records)
    groups = defaultdict(list)
    if group_by:
        for record in selected:
            groups[_group_key(record, group_by)].append(record)
    return {
        "metric": metric,
        "field": field,
        "groupBy": group_by,
        "totals": _summary(selected, metric, field),
        "groups": [
            {"key": key, **_summary(groups[key], metric, field)}
            for key in sorted(groups, key=_sort_group)
        ],
    }


def expand_cohort(records, selected, spec):
    """Join only within authorized records, using explicit verified identities.

    Same-source contacts are already scoped by the CRM. Cross-source matching
    exclusively uses the HMAC verifiedIdentityId exported by the trusted bridge.
    Temporal bounds apply per anchor, inclusively, in elapsed days.
    """
    if not isinstance(spec, dict) or set(spec) - {
        "recordIds",
        "conditions",
        "targetKinds",
        "relation",
        "days",
        "attemptPolicy",
    }:
        _error("ساختار پیوند گروه معتبر نیست.")
    if "recordIds" in spec and "conditions" in spec:
        _error("مبدأ پیوند را با شناسه یا شرط انتخاب کنید.")
    available = {record["id"]: record for record in records}
    policy = spec.get("attemptPolicy", "all")
    if "recordIds" in spec:
        identifiers = spec["recordIds"]
        if (
            not isinstance(identifiers, list)
            or len(identifiers) > 1000
            or any(
                not isinstance(identifier, str) or identifier not in available
                for identifier in identifiers
            )
        ):
            _error("شناسهٔ مبدأ پیوند خارج از دامنهٔ مجاز یا نامعتبر است.")
        anchors, policy_summary = apply_attempt_policy(
            [available[identifier] for identifier in dict.fromkeys(identifiers)], policy
        )
    elif "conditions" in spec:
        candidates, policy_summary = apply_attempt_policy(records, policy)
        anchors = select_records(candidates, spec["conditions"])
    else:
        anchors, policy_summary = apply_attempt_policy(
            [available[row["id"]] for row in selected if row["id"] in available], policy
        )
    kinds = spec.get("targetKinds", ["message", "test", "match"])
    if (
        not isinstance(kinds, list)
        or not kinds
        or any(
            not isinstance(kind, str) or kind not in {"message", "test", "match"}
            for kind in kinds
        )
    ):
        _error("نوع رکورد مقصد پیوند معتبر نیست.")
    relation = spec.get("relation", "all")
    if not isinstance(relation, str) or relation not in {"all", "before", "after"}:
        _error("جهت زمانی پیوند معتبر نیست.")
    days = spec.get("days")
    if days is not None and (not _number(days) or not 0 <= days <= 36500):
        _error("فاصلهٔ زمانی پیوند معتبر نیست.")

    def identity(record):
        value = (record.get("metadata") or {}).get("verifiedIdentityId")
        return value if isinstance(value, str) and value.strip() else None

    def local(record):
        source, contact = record.get("source_id"), record.get("contact_id")
        return (source, contact) if source and contact else None

    indexed = defaultdict(list)
    for anchor in anchors:
        if identity(anchor):
            indexed[("verified", identity(anchor))].append(anchor)
        if local(anchor):
            indexed[("local", *local(anchor))].append(anchor)
    matched_anchors = set()
    linked = []
    for record in records:
        if record["kind"] not in kinds:
            continue
        candidates = []
        if identity(record):
            candidates.extend(indexed[("verified", identity(record))])
        if local(record):
            candidates.extend(indexed[("local", *local(record))])
        accepted = False
        for anchor in candidates:
            if relation != "all" or days is not None:
                stamp, anchor_stamp = (
                    record.get("occurred_at"),
                    anchor.get("occurred_at"),
                )
                if not _number(stamp) or not _number(anchor_stamp):
                    continue
                difference = stamp - anchor_stamp
                if relation == "before" and difference > 0:
                    continue
                if relation == "after" and difference < 0:
                    continue
                if days is not None and abs(difference) > days * 86400:
                    continue
            matched_anchors.add(anchor["id"])
            accepted = True
        if accepted:
            linked.append(record)
    verified = sum(identity(anchor) is not None for anchor in anchors)
    return linked, {
        **attempt_selection_summary(anchors, policy_summary),
        "anchorRecords": len(anchors),
        "verifiedAnchorRecords": verified,
        "unlinkedAnchorRecords": len(anchors) - verified,
        "matchedAnchorRecords": len(matched_anchors),
        "selected": len(linked),
        "baseEligible": len(records),
        "targetKinds": kinds,
        "relation": relation,
        "days": days,
        "recordIds": [record["id"] for record in linked[:100]],
        "recordIdsTruncated": len(linked) > 100,
        "notice": "پیوند بین منابع فقط با هویت تأییدشده است؛ رکورد فاقد پیوند تنها در همان منبع قابل انتساب است. حدود زمانی شامل دو سر بازه‌اند.",
    }


def field_catalog():
    """Describe the vocabulary accepted by the model-facing research tools."""
    return {
        "fields": [
            *DIRECT_FIELDS,
            "testKey",
            "verifiedIdentityId",
            *["demographics." + field for field in sorted(DEMOGRAPHIC_FIELDS)],
            "scores.<scale>",
        ],
        "groupingFields": ["day"],
        "operators": sorted(OPERATORS),
        "metrics": sorted(METRICS),
        "conditionSemantics": "Conditions combine with AND. Missing values never match. Demographic text normalizes Persian variants. Numeric values must be finite numbers.",
        "denominators": "eligible is record count. measured counts valid observations. missing is eligible minus measured. distinctContacts uses (sourceId,contactId).",
    }
