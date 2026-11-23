"""Verified cross-source cohort joins, using synthetic identities only."""

import unittest

from analytics.research_tools import expand_cohort
from analytics.storage import AnalyticsError


def record(identifier, source, contact, verified=None, kind="message", stamp=1000000):
    return {
        "id": identifier,
        "source_id": source,
        "contact_id": contact,
        "kind": kind,
        "occurred_at": stamp,
        "metadata": {"verifiedIdentityId": verified},
    }


class VerifiedCohortTests(unittest.TestCase):
    def test_cross_source_requires_verified_mapping_and_does_not_guess_contact_id(self):
        anchor = record("test", "tests", "same-name", "verified-a", "test")
        linked = record("linked", "chat", "different-name", "verified-a")
        unrelated = record("unrelated", "chat", "same-name")
        wrong_link = record("wrong-link", "chat", "same-name", "verified-b")
        result, coverage = expand_cohort(
            [anchor, linked, unrelated, wrong_link],
            [anchor],
            {"targetKinds": ["message"]},
        )
        self.assertEqual([row["id"] for row in result], ["linked"])
        self.assertEqual(coverage["verifiedAnchorRecords"], 1)
        self.assertEqual(coverage["matchedAnchorRecords"], 1)

    def test_same_source_contact_is_usable_without_cross_source_link(self):
        anchor = record("test", "source", "person", kind="test")
        same = record("same", "source", "person")
        different_source = record("other", "other", "person")
        result, coverage = expand_cohort(
            [anchor, same, different_source], [anchor], {"targetKinds": ["message"]}
        )
        self.assertEqual(result, [same])
        self.assertEqual(coverage["unlinkedAnchorRecords"], 1)

    def test_missing_contact_never_links_unrelated_missing_values(self):
        anchor = record("anchor", "s", None, kind="test")
        other = record("other", "s", None)
        result, coverage = expand_cohort([anchor, other], [anchor], {})
        self.assertEqual(result, [])
        self.assertEqual(coverage["matchedAnchorRecords"], 0)

    def test_temporal_join_has_inclusive_bounds_and_no_repeats(self):
        anchor = record("test", "tests", "p", "v", "test")
        rows = [
            anchor,
            record("before", "chat", "p", "v", stamp=1000000 - 86400),
            record("same", "chat", "p", "v", stamp=1000000),
            record("after", "chat", "p", "v", stamp=1000000 + 86400),
            record("late", "chat", "p", "v", stamp=1000000 + 86401),
        ]
        result, _ = expand_cohort(
            rows, [anchor], {"targetKinds": ["message"], "relation": "after", "days": 1}
        )
        self.assertEqual([row["id"] for row in result], ["same", "after"])
        result, _ = expand_cohort(
            rows,
            [anchor],
            {"targetKinds": ["message"], "relation": "before", "days": 1},
        )
        self.assertEqual([row["id"] for row in result], ["before", "same"])

    def test_explicit_ids_and_conditions_never_escape_authorized_records(self):
        anchor = record("test", "tests", "p", "v", "test")
        linked = record("message", "chat", "p", "v")
        result, _ = expand_cohort(
            [anchor, linked], [], {"recordIds": ["test"], "targetKinds": ["message"]}
        )
        self.assertEqual(result, [linked])
        result, _ = expand_cohort(
            [anchor, linked],
            [],
            {
                "conditions": [{"field": "kind", "operator": "eq", "value": "test"}],
                "targetKinds": ["message"],
            },
        )
        self.assertEqual(result, [linked])
        with self.assertRaises(AnalyticsError):
            expand_cohort([anchor], [], {"recordIds": ["outside"]})

    def test_invalid_specs_fail_with_controlled_contract_error(self):
        for spec in (
            {"recordIds": ["x"], "conditions": []},
            {"targetKinds": [{}]},
            {"relation": {}},
            {"days": True},
            {"days": float("nan")},
            {"days": -1},
            {"recordIds": "x"},
            {"unknown": "value"},
        ):
            with self.subTest(spec=spec), self.assertRaises(AnalyticsError):
                expand_cohort([], [], spec)
