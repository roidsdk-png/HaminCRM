"""Repeated questionnaire attempts must form an explicit reproducible cohort."""

import unittest

from analytics.research_tools import (
    apply_attempt_policy,
    attempt_selection_summary,
    expand_cohort,
    select_records,
)
from analytics.storage import AnalyticsError


def attempt(
    identifier,
    contact="person",
    key="test",
    score=10,
    stamp=100,
    source="source",
    **metadata,
):
    return {
        "id": identifier,
        "kind": "test",
        "source_id": source,
        "contact_id": contact,
        "occurred_at": stamp,
        "metadata": {"testKey": key, "scores": {"scale": score}, **metadata},
    }


class AttemptPolicyTests(unittest.TestCase):
    def test_latest_is_selected_before_score_condition_not_latest_qualifying_attempt(
        self,
    ):
        old = attempt("old", score=20, stamp=100)
        new = attempt("new", score=2, stamp=200)
        conditions = [{"field": "scores.scale", "operator": "gte", "value": 10}]
        self.assertEqual(
            select_records([old, new], conditions, "latest_per_contact"), []
        )
        self.assertEqual(select_records([old, new], conditions, "all"), [old])

    def test_deduplication_keeps_source_test_and_missing_contacts_separate(self):
        rows = [
            attempt("old", stamp=100),
            attempt("new", stamp=200),
            attempt("another-test", key="another"),
            attempt("another-source", source="another"),
            attempt("unknown-a", contact=None),
            attempt("unknown-b", contact=None),
            attempt("unknown-test-a", key=None),
            attempt("unknown-test-b", key=None),
        ]
        result, summary = apply_attempt_policy(rows, "latest_per_contact")
        self.assertEqual([row["id"] for row in result], [row["id"] for row in rows[1:]])
        summary = attempt_selection_summary(result, summary)
        self.assertEqual(summary["eligibleAttempts"], 8)
        self.assertEqual(summary["selectedAttempts"], 7)
        self.assertEqual(summary["selectedParticipants"], 2)
        self.assertEqual(summary["unidentifiedSelectedAttempts"], 2)

    def test_timestamp_tie_breaker_is_deterministic_record_id(self):
        a, z = attempt("a"), attempt("z")
        self.assertEqual(apply_attempt_policy([z, a], "latest_per_contact")[0], [z])
        self.assertEqual(apply_attempt_policy([a, z], "latest_per_contact")[0], [z])

    def test_incomplete_attempt_does_not_replace_last_completed_attempt(self):
        completed = attempt("completed", stamp=100)
        incomplete = attempt("incomplete", stamp=200, completed=False)
        pending = attempt("pending", stamp=300, status="pending")
        self.assertEqual(
            apply_attempt_policy(
                [completed, incomplete, pending], "latest_per_contact"
            )[0],
            [completed],
        )

    def test_message_records_remain_unchanged(self):
        message = {**attempt("message"), "kind": "message"}
        self.assertEqual(
            apply_attempt_policy([message], "latest_per_contact")[0], [message]
        )

    def test_expand_conditions_apply_latest_policy_before_score_cohort(self):
        old = attempt("old", score=20, stamp=100, verifiedIdentityId="v")
        new = attempt("new", score=2, stamp=200, verifiedIdentityId="v")
        message = {
            **attempt("message", source="chat", verifiedIdentityId="v"),
            "kind": "message",
            "metadata": {"verifiedIdentityId": "v"},
        }
        selected, coverage = expand_cohort(
            [old, new, message],
            [],
            {
                "attemptPolicy": "latest_per_contact",
                "targetKinds": ["message"],
                "conditions": [
                    {"field": "scores.scale", "operator": "gte", "value": 10}
                ],
            },
        )
        self.assertEqual(selected, [])
        self.assertEqual(coverage["eligibleAttempts"], 2)
        self.assertEqual(coverage["consideredAttempts"], 1)
        self.assertEqual(coverage["selectedParticipants"], 0)

    def test_invalid_policy_is_rejected_even_for_empty_input(self):
        for value in ({}, "guess_latest", True):
            with self.subTest(value=value), self.assertRaises(AnalyticsError):
                apply_attempt_policy([], value)
