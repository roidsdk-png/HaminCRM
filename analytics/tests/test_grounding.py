"""Numerical claims are tested with synthetic results and no model calls."""

import unittest

from analytics.grounding import validate_numeric_claims
from analytics.storage import AnalyticsError


class NumericGroundingTests(unittest.TestCase):
    def check(self, answer, claims=None, value=2, quotes=()):
        validate_numeric_claims(
            answer,
            claims,
            [{"totals": {"value": value}}],
            {"totals": {"contacts": 2}},
            quotes,
        )

    def claim(self, value=2):
        return [{"value": value, "path": "calculations.0.totals.value"}]

    def assert_invalid(self, callback):
        with self.assertRaises(AnalyticsError) as raised:
            callback()
        self.assertEqual(raised.exception.code, "invalid_numeric_claim")

    def test_matching_calculation_is_accepted(self):
        self.check("در این گروه 2 مخاطب وجود دارد.", self.claim())

    def test_correct_calculation_cannot_support_different_prose_number(self):
        self.assert_invalid(lambda: self.check("1000 مخاطب وجود دارد.", self.claim()))

    def test_persian_and_arabic_digits_match_ascii_result(self):
        self.check("۲ مخاطب و ٢ رکورد بررسی شد.", self.claim())

    def test_grouped_decimal_and_negative_number_are_normalized(self):
        self.check("مقدار ۱٬۲۳۴٫۵ ثبت شد.", self.claim(1234.5), value=1234.5)
        self.check("مقدار −۲ ثبت شد.", self.claim(-2), value=-2)

    def test_exact_source_quote_can_support_a_number(self):
        self.check("مخاطب گفته ۳۰ سال داشته است.", quotes=["آن زمان 30 سال داشتم"])

    def test_statistics_path_is_accepted(self):
        self.check(
            "تعداد مخاطبان 2 است.", [{"value": 2, "path": "statistics.totals.contacts"}]
        )

    def test_empty_claims_are_valid_for_non_numeric_text(self):
        self.check("مخاطب از یک تجربهٔ دشوار سخن گفته است.")

    def test_missing_or_executable_paths_are_rejected(self):
        for path in [
            "calculations.9.totals.value",
            "statistics.missing",
            "__import__('os')",
            "statistics.__class__",
            "calculations.-1.totals.value",
        ]:
            with self.subTest(path=path):
                self.assert_invalid(
                    lambda: self.check("2", [{"value": 2, "path": path}])
                )

    def test_boolean_nonfinite_and_string_claim_values_are_rejected(self):
        for value in [True, False, float("nan"), float("inf"), "2"]:
            with self.subTest(value=value):
                self.assert_invalid(lambda: self.check("2", self.claim(value)))

    def test_claim_value_must_equal_resolved_number(self):
        self.assert_invalid(lambda: self.check("3", self.claim(3)))

    def test_escaped_numerical_brackets_do_not_bypass_validation(self):
        self.assert_invalid(
            lambda: self.check(r"تعداد \[1000\] نفر است.", self.claim())
        )

    def test_evidence_hash_and_record_uuid_are_reference_identifiers(self):
        evidence = "a1" * 20
        record = "12345678-1234-1234-1234-123456789012"
        self.check(f"بر اساس [{evidence}] و [message:{record}] این تجربه بررسی شد.")
        self.check(r"بر اساس \[" + evidence + r"\] این تجربه بررسی شد.")

    def test_numerical_token_joined_to_persian_word_is_still_checked(self):
        self.assert_invalid(lambda: self.check("1000نفر گزارش داده‌اند.", self.claim()))

    def test_malformed_claim_shape_is_rejected(self):
        self.assert_invalid(lambda: self.check("2", {"value": 2}))
        self.assert_invalid(
            lambda: self.check(
                "2",
                [{"value": 2, "path": "statistics.totals.contacts", "eval": "ignored"}],
            )
        )
