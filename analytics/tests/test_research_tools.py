"""Cohort and calculation regressions with synthetic records only."""

import math
import unittest
from datetime import datetime

from analytics.corpus import TEHRAN
from analytics.research_tools import aggregate_records, field_catalog, select_records
from analytics.storage import AnalyticsError


def record(identifier, source="bale", contact="person", score=10, **changes):
    value = {
        "id": identifier,
        "kind": "test",
        "source_id": source,
        "contact_id": contact,
        "conversation_id": None,
        "role": "user",
        "occurred_at": int(datetime(2026, 11, 23, tzinfo=TEHRAN).timestamp()),
        "metadata": {
            "testKey": "test-anxiety",
            "scores": {"anxiety": score},
            "demographics": {"age": 30, "province": "تهران", "gender": "female"},
        },
    }
    value.update(changes)
    return value


class SelectionTests(unittest.TestCase):
    def test_conditions_form_a_cohort_without_expanding_the_input_scope(self):
        rows = [
            record("one", score=5),
            record("two", score=15),
            record("three", source="eitaa", score=19),
        ]
        result = select_records(
            rows,
            [
                {"field": "sourceId", "operator": "eq", "value": "bale"},
                {"field": "scores.anxiety", "operator": "gte", "value": 10},
            ],
        )
        self.assertEqual([row["id"] for row in result], ["two"])
        self.assertIs(result[0], rows[1])

    def test_missing_nonfinite_boolean_and_numeric_strings_do_not_match_numbers(self):
        rows = [
            record(str(index), score=value)
            for index, value in enumerate([None, math.nan, math.inf, True, "12", 12])
        ]
        result = select_records(
            rows, [{"field": "scores.anxiety", "operator": "gte", "value": 10}]
        )
        self.assertEqual([row["id"] for row in result], ["5"])

    def test_inequality_does_not_turn_missing_data_into_an_observation(self):
        rows = [record("missing", score=None), record("present", score=5)]
        result = select_records(
            rows, [{"field": "scores.anxiety", "operator": "ne", "value": 10}]
        )
        self.assertEqual([row["id"] for row in result], ["present"])

    def test_text_matching_normalizes_persian_variants(self):
        rows = [
            record("one", metadata={"demographics": {"province": "آذربایجان شرقی"}})
        ]
        self.assertEqual(
            select_records(
                rows,
                [
                    {
                        "field": "demographics.province",
                        "operator": "contains",
                        "value": "شرقي",
                    }
                ],
            ),
            rows,
        )

    def test_in_and_lte_combine_with_and(self):
        rows = [
            record("one", score=5),
            record("two", score=10),
            record("three", score=20),
        ]
        selected = select_records(
            rows,
            [
                {"field": "scores.anxiety", "operator": "in", "value": [5, 10]},
                {"field": "scores.anxiety", "operator": "lte", "value": 5},
            ],
        )
        self.assertEqual([row["id"] for row in selected], ["one"])

    def test_nonapproved_fields_and_invalid_conditions_are_rejected_before_reading(
        self,
    ):
        invalid = [
            {"field": "metadata.phone", "operator": "eq", "value": "x"},
            {"field": "text", "operator": "contains", "value": "private"},
            {"field": "scores.x.y", "operator": "eq", "value": 1},
            {"field": "scores.anxiety", "operator": "gte", "value": True},
            {"field": "scores.anxiety", "operator": "eq", "value": math.nan},
            {"field": "sourceId", "operator": "gte", "value": 1},
            {"field": "sourceId", "operator": "in", "value": []},
            {"field": "sourceId", "operator": "contains", "value": ""},
            {"field": "sourceId", "operator": "exec", "value": "x"},
            {
                "field": "sourceId",
                "operator": "eq",
                "value": "x",
                "sql": "drop table records",
            },
        ]
        for condition in invalid:
            with self.subTest(condition=condition), self.assertRaises(AnalyticsError):
                select_records([], [condition])

    def test_empty_conditions_preserve_the_scope(self):
        rows = [record("one")]
        self.assertEqual(select_records(rows, []), rows)

    def test_structural_identity_comparison_remains_case_sensitive(self):
        rows = [record("one", source="Source-A"), record("two", source="source-a")]
        selected = select_records(
            rows, [{"field": "sourceId", "operator": "eq", "value": "Source-A"}]
        )
        self.assertEqual([item["id"] for item in selected], ["one"])


class AggregationTests(unittest.TestCase):
    def test_distinct_people_are_scoped_to_source_and_missing_id_is_reported(self):
        rows = [
            record("one"),
            record("two"),
            record("three", source="eitaa"),
            record("four", contact=None),
        ]
        result = aggregate_records(rows, {"metric": "distinctContacts"})
        self.assertEqual(
            result["totals"], {"eligible": 4, "measured": 3, "missing": 1, "value": 2}
        )

    def test_average_uses_valid_numeric_observations_as_denominator(self):
        rows = [
            record("one", score=0),
            record("two", score=20),
            record("three", score=None),
            record("four", score="30"),
            record("five", score=True),
        ]
        result = aggregate_records(
            rows, {"metric": "average", "field": "scores.anxiety"}
        )
        self.assertEqual(
            result["totals"], {"eligible": 5, "measured": 2, "missing": 3, "value": 10}
        )

    def test_empty_numeric_group_is_null_and_real_zero_is_preserved(self):
        rows = [record("one", score=None), record("two", source="eitaa", score=0)]
        result = aggregate_records(
            rows, {"metric": "sum", "field": "scores.anxiety", "groupBy": "sourceId"}
        )
        self.assertEqual(
            result["groups"],
            [
                {
                    "key": "bale",
                    "eligible": 1,
                    "measured": 0,
                    "missing": 1,
                    "value": None,
                },
                {
                    "key": "eitaa",
                    "eligible": 1,
                    "measured": 1,
                    "missing": 0,
                    "value": 0,
                },
            ],
        )

    def test_grouping_uses_tehran_day_at_utc_boundary(self):
        midnight = int(datetime(2026, 11, 23, tzinfo=TEHRAN).timestamp())
        rows = [
            record("before", occurred_at=midnight - 1),
            record("at", occurred_at=midnight),
        ]
        result = aggregate_records(rows, {"metric": "count", "groupBy": "day"})
        self.assertEqual(
            [(group["key"], group["value"]) for group in result["groups"]],
            [("2026-11-22", 1), ("2026-11-23", 1)],
        )

    def test_numeric_groups_sort_numerically_with_unknown_group_last(self):
        rows = [
            record("one", score=20),
            record("two", score=3),
            record("three", score=None),
        ]
        result = aggregate_records(
            rows, {"metric": "count", "groupBy": "scores.anxiety"}
        )
        self.assertEqual([group["key"] for group in result["groups"]], [3, 20, None])

    def test_sum_min_and_max_are_deterministic(self):
        rows = [
            record("one", score=-2),
            record("two", score=9),
            record("three", score=1),
        ]
        for metric, expected in [("sum", 8), ("min", -2), ("max", 9)]:
            with self.subTest(metric=metric):
                self.assertEqual(
                    aggregate_records(
                        rows, {"metric": metric, "field": "scores.anxiety"}
                    )["totals"]["value"],
                    expected,
                )

    def test_floating_sum_avoids_avoidable_cancellation_error(self):
        rows = [
            record("one", score=1e16),
            record("two", score=1.0),
            record("three", score=-1e16),
        ]
        self.assertEqual(
            aggregate_records(rows, {"metric": "sum", "field": "scores.anxiety"})[
                "totals"
            ]["value"],
            1.0,
        )

    def test_invalid_aggregate_specs_are_rejected_even_on_empty_input(self):
        specs = [
            {"metric": "sql"},
            {"metric": "average"},
            {"metric": "average", "field": "demographics.gender"},
            {"metric": "sum", "field": "metadata.phone"},
            {"metric": "count", "field": "scores.anxiety"},
            {"metric": "count", "groupBy": "metadata.name"},
            {"metric": "count", "query": "select *"},
        ]
        for spec in specs:
            with self.subTest(spec=spec), self.assertRaises(AnalyticsError):
                aggregate_records([], spec)

    def test_numeric_overflow_is_explicit(self):
        rows = [record("one", score=1e308), record("two", score=1e308)]
        with self.assertRaises(AnalyticsError):
            aggregate_records(rows, {"metric": "sum", "field": "scores.anxiety"})

    def test_catalog_describes_exact_supported_vocabulary(self):
        catalog = field_catalog()
        self.assertIn("scores.<scale>", catalog["fields"])
        self.assertIn("average", catalog["metrics"])
        self.assertEqual(catalog["groupingFields"], ["day"])


if __name__ == "__main__":
    unittest.main()
