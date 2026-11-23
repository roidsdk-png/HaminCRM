"""Offline, reproducible scoring of human labels and model predictions.

This module never calls a model or reads the CRM database. It checks observable
claims only; semantic correctness and adequate anonymisation need human review.
"""

import math
from collections import Counter

from .grounding import number, numbers


class EvaluationInputError(ValueError):
    pass


def _index(document, name):
    if (
        not isinstance(document, dict)
        or type(document.get("schemaVersion")) is not int
        or document.get("schemaVersion") != 1
    ):
        raise EvaluationInputError(f"{name}: schemaVersion must be 1")
    cases = document.get("cases")
    if not isinstance(cases, list) or not cases:
        raise EvaluationInputError(f"{name}: cases must be a nonempty list")
    indexed = {}
    for case in cases:
        if not isinstance(case, dict):
            raise EvaluationInputError(f"{name}: each case must be an object")
        case_id = case.get("id")
        if not isinstance(case_id, str) or not case_id.strip():
            raise EvaluationInputError(f"{name}: each case needs a nonempty id")
        if case_id in indexed:
            raise EvaluationInputError(f"{name}: duplicate id {case_id}")
        labels = case.get("labels")
        if not isinstance(labels, list) or any(
            not isinstance(label, str) or not label.strip() for label in labels
        ):
            raise EvaluationInputError(f"{name}: {case_id}: labels must be strings")
        if len(set(labels)) != len(labels):
            raise EvaluationInputError(f"{name}: {case_id}: duplicate labels")
        indexed[case_id] = case
    return indexed


def _ratio(numerator, denominator):
    return round(numerator / denominator, 6) if denominator else None


def _metrics(tp, fp, fn):
    return {
        "truePositive": tp,
        "falsePositive": fp,
        "falseNegative": fn,
        "precision": _ratio(tp, tp + fp),
        "recall": _ratio(tp, tp + fn),
        "f1": _ratio(2 * tp, 2 * tp + fp + fn),
    }


def evaluate(gold_document, prediction_document):
    """Compare exact multi-label sets, literal evidence and annotated claims.

    Missing predictions are scored as empty label sets. Unexpected predictions
    are scored as false positives. Error reports contain IDs and codes, never
    source text or identifiable evidence.
    """
    gold = _index(gold_document, "gold")
    predictions = _index(prediction_document, "predictions")
    errors = []
    counts = {key: Counter() for key in ("tp", "fp", "fn")}
    evidence_total = evidence_valid = evidence_cases = evidence_cases_valid = 0
    identity_total = identity_valid = attribution_total = attribution_valid = 0
    numeric_total = numeric_valid = exact_labels = 0
    missing = sorted(gold.keys() - predictions.keys())
    unexpected = sorted(predictions.keys() - gold.keys())

    def fail(case_id, code, **extra):
        errors.append({"id": case_id, "code": code, **extra})

    for case_id in sorted(gold.keys() | predictions.keys()):
        expected = gold.get(case_id)
        predicted = predictions.get(case_id)
        truth_labels = set(expected["labels"]) if expected else set()
        actual_labels = set(predicted["labels"]) if predicted else set()
        counts["tp"].update(truth_labels & actual_labels)
        counts["fp"].update(actual_labels - truth_labels)
        counts["fn"].update(truth_labels - actual_labels)
        if expected is None:
            fail(case_id, "unexpected_prediction")
            continue
        if predicted is None:
            fail(case_id, "missing_prediction")
            predicted = {"labels": [], "evidence": []}
        elif truth_labels == actual_labels:
            exact_labels += 1
        text = expected.get("text")
        if not isinstance(text, str):
            raise EvaluationInputError(f"gold: {case_id}: text must be a string")
        if "evidenceRequired" in expected and not isinstance(
            expected["evidenceRequired"], bool
        ):
            raise EvaluationInputError(
                f"gold: {case_id}: evidenceRequired must be boolean"
            )
        if "contactId" in expected and (
            not isinstance(expected["contactId"], str)
            or not expected["contactId"].strip()
        ):
            raise EvaluationInputError(
                f"gold: {case_id}: contactId must be a nonempty pseudonym"
            )
        if "attribution" in expected and expected["attribution"] not in (
            "self",
            "other",
            "hypothetical",
            "unknown",
        ):
            raise EvaluationInputError(f"gold: {case_id}: invalid attribution")
        evidence = predicted.get("evidence", [])
        if not isinstance(evidence, list):
            raise EvaluationInputError(
                f"predictions: {case_id}: evidence must be a list"
            )
        valid_quotes = []
        for index, item in enumerate(evidence):
            if not isinstance(item, dict) or not isinstance(item.get("quote"), str):
                raise EvaluationInputError(f"predictions: {case_id}: invalid evidence")
            quote = item["quote"]
            evidence_total += 1
            if quote.strip() and quote in text:
                evidence_valid += 1
                valid_quotes.append(quote)
            else:
                fail(case_id, "unfaithful_quote", evidenceIndex=index)
            for key, code in (
                ("contactId", "incorrect_identity"),
                ("attribution", "incorrect_attribution"),
            ):
                if key not in expected:
                    continue
                matched = item.get(key) == expected[key]
                if key == "contactId":
                    identity_total += 1
                    identity_valid += int(matched)
                else:
                    attribution_total += 1
                    attribution_valid += int(matched)
                if not matched:
                    fail(case_id, code, evidenceIndex=index)
        if expected.get("evidenceRequired", False):
            evidence_cases += 1
            if valid_quotes:
                evidence_cases_valid += 1
            else:
                fail(case_id, "missing_required_evidence")
        if "expectedNumbers" in expected:
            values = expected["expectedNumbers"]
            if not isinstance(values, list) or any(
                isinstance(value, bool)
                or not isinstance(value, (int, float))
                or (isinstance(value, float) and not math.isfinite(value))
                for value in values
            ):
                raise EvaluationInputError(f"gold: {case_id}: invalid expectedNumbers")
            answer = predicted.get("answer", "")
            if not isinstance(answer, str):
                raise EvaluationInputError(
                    f"predictions: {case_id}: answer must be a string"
                )
            numeric_total += 1
            allowed = {number(value) for value in values}
            for quote in valid_quotes:
                allowed.update(numbers(quote))
            if case_id in predictions and numbers(answer).issubset(allowed):
                numeric_valid += 1
            elif case_id in predictions:
                fail(case_id, "unsupported_number")
    labels = sorted(set().union(*(counter.keys() for counter in counts.values())))
    per_label = {
        label: _metrics(*(counts[key][label] for key in ("tp", "fp", "fn")))
        for label in labels
    }
    macro_f1 = [value["f1"] for value in per_label.values() if value["f1"] is not None]
    return {
        "schemaVersion": 1,
        "cases": {
            "gold": len(gold),
            "predicted": len(predictions),
            "missing": missing,
            "unexpected": unexpected,
        },
        "labels": {
            "micro": _metrics(
                *(sum(counts[key].values()) for key in ("tp", "fp", "fn"))
            ),
            "macroF1": round(sum(macro_f1) / len(macro_f1), 6) if macro_f1 else None,
            "exactMatch": _ratio(exact_labels, len(gold)),
            "perLabel": per_label,
        },
        "evidence": {
            "checked": evidence_total,
            "faithful": evidence_valid,
            "faithfulness": _ratio(evidence_valid, evidence_total),
            "requiredCases": evidence_cases,
            "coveredCases": evidence_cases_valid,
            "coverage": _ratio(evidence_cases_valid, evidence_cases),
        },
        "identity": {
            "checked": identity_total,
            "correct": identity_valid,
            "accuracy": _ratio(identity_valid, identity_total),
        },
        "attribution": {
            "checked": attribution_total,
            "correct": attribution_valid,
            "accuracy": _ratio(attribution_valid, attribution_total),
        },
        "numbers": {
            "checkedCases": numeric_total,
            "supportedCases": numeric_valid,
            "supportRate": _ratio(numeric_valid, numeric_total),
        },
        "errors": errors,
        "passedStructuralChecks": not errors,
        "limitations": [
            "Literal quote matching and numeric value checks do not prove semantic correctness.",
            "Human review is required for interpretation, redaction quality and representative sampling.",
            "Undefined rates are null, never perfect scores.",
        ],
    }
