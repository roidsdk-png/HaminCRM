"""Evaluation scores are calculated from synthetic annotations, without API use."""

import json
import unittest
from copy import deepcopy
from pathlib import Path

from analytics.evaluation import EvaluationInputError, evaluate

FIXTURES = Path(__file__).parent / "fixtures"


class OfflineEvaluationTests(unittest.TestCase):
    def setUp(self):
        self.gold = json.loads(
            (FIXTURES / "evaluation-gold.synthetic.json").read_text(encoding="utf-8")
        )
        self.predictions = json.loads(
            (FIXTURES / "evaluation-predictions.synthetic.json").read_text(
                encoding="utf-8"
            )
        )

    def score(self):
        return evaluate(self.gold, self.predictions)

    def test_complete_synthetic_example_scores_exactly(self):
        report = self.score()
        self.assertTrue(report["passedStructuralChecks"])
        self.assertEqual(report["labels"]["micro"]["f1"], 1)
        self.assertEqual(report["evidence"]["faithfulness"], 1)
        self.assertEqual(report["identity"]["checked"], 2)

    def test_precision_recall_and_multilabel_false_negatives(self):
        self.predictions["cases"][0]["labels"] = ["ترس از ازدواج", "خشم"]
        metrics = self.score()["labels"]["micro"]
        self.assertEqual(
            (
                metrics["truePositive"],
                metrics["falsePositive"],
                metrics["falseNegative"],
            ),
            (2, 1, 1),
        )
        self.assertAlmostEqual(metrics["precision"], 2 / 3, places=6)
        self.assertAlmostEqual(metrics["recall"], 2 / 3, places=6)

    def test_missing_prediction_is_reported_and_reduces_recall(self):
        self.predictions["cases"].pop()
        report = self.score()
        self.assertEqual(report["cases"]["missing"], ["synthetic-2"])
        self.assertEqual(report["labels"]["micro"]["falseNegative"], 1)
        self.assertEqual(report["evidence"]["coverage"], 0.5)
        self.assertEqual(report["numbers"]["supportRate"], 0.5)
        self.assertFalse(report["passedStructuralChecks"])

    def test_unexpected_prediction_contributes_false_positive(self):
        extra = deepcopy(self.predictions["cases"][0])
        extra["id"] = "unrequested-case"
        self.predictions["cases"].append(extra)
        report = self.score()
        self.assertEqual(report["labels"]["micro"]["falsePositive"], 2)
        self.assertEqual(report["cases"]["unexpected"], ["unrequested-case"])

    def test_duplicate_ids_and_labels_are_rejected(self):
        duplicate = deepcopy(self.predictions["cases"][0])
        self.predictions["cases"].append(duplicate)
        with self.assertRaises(EvaluationInputError):
            self.score()
        self.predictions["cases"].pop()
        duplicate["labels"].append(duplicate["labels"][0])
        self.predictions["cases"][0] = duplicate
        with self.assertRaises(EvaluationInputError):
            self.score()

    def test_empty_corpora_and_invalid_versions_are_rejected(self):
        for invalid in (
            {"schemaVersion": 1, "cases": []},
            {"schemaVersion": 2, "cases": [{}]},
        ):
            with self.subTest(invalid=invalid), self.assertRaises(EvaluationInputError):
                evaluate(invalid, self.predictions)

    def test_approximate_or_empty_quote_is_not_faithful(self):
        self.predictions["cases"][0]["evidence"][0]["quote"] = (
            "از شروع زندگی مشترک می ترسم"
        )
        self.predictions["cases"][1]["evidence"][0]["quote"] = ""
        report = self.score()
        self.assertEqual(report["evidence"]["faithfulness"], 0)
        self.assertEqual(report["evidence"]["coverage"], 0)

    def test_wrong_contact_and_self_attribution_are_critical_errors(self):
        item = self.predictions["cases"][1]["evidence"][0]
        item["contactId"] = "another-source:synthetic-user-2"
        item["attribution"] = "self"
        report = self.score()
        self.assertEqual(report["identity"]["accuracy"], 0.5)
        self.assertEqual(report["attribution"]["accuracy"], 0.5)
        self.assertIn(
            "incorrect_identity", [error["code"] for error in report["errors"]]
        )

    def test_unfaithful_quote_cannot_whitelist_fabricated_number(self):
        case = self.predictions["cases"][0]
        case["evidence"][0]["quote"] = "1000 مخاطب"
        case["answer"] = "1000 مخاطب گفته‌اند."
        self.assertIn(
            "unsupported_number", [error["code"] for error in self.score()["errors"]]
        )

    def test_human_annotated_calculation_allows_persian_numerals(self):
        self.gold["cases"][0]["expectedNumbers"] = [1234.5]
        self.predictions["cases"][0]["answer"] = "مقدار ثبت‌شده ۱٬۲۳۴٫۵ است."
        self.assertTrue(self.score()["passedStructuralChecks"])

    def test_report_does_not_copy_source_text(self):
        self.predictions["cases"][0]["evidence"][0]["quote"] = "ساختگی و محرمانه"
        report = json.dumps(self.score(), ensure_ascii=False)
        self.assertNotIn("ساختگی و محرمانه", report)
        self.assertNotIn(self.gold["cases"][0]["text"], report)

    def test_unmeasured_rates_are_null(self):
        for document in (self.gold, self.predictions):
            for case in document["cases"]:
                case["labels"] = []
                case.pop("evidenceRequired", None)
                case.pop("expectedNumbers", None)
                case.pop("evidence", None)
        report = self.score()
        self.assertIsNone(report["labels"]["micro"]["precision"])
        self.assertIsNone(report["evidence"]["faithfulness"])
        self.assertIsNone(report["numbers"]["supportRate"])

    def test_malformed_predictions_do_not_silently_pass(self):
        for value in (None, "quote", [None]):
            with self.subTest(value=value):
                original = deepcopy(self.predictions)
                self.predictions["cases"][0]["evidence"] = value
                with self.assertRaises(EvaluationInputError):
                    self.score()
                self.predictions = original

    def test_invalid_annotation_types_are_rejected(self):
        for key, value in (
            ("evidenceRequired", "false"),
            ("contactId", ""),
            ("contactId", None),
            ("attribution", "guess"),
            ("expectedNumbers", [True]),
            ("expectedNumbers", [float("nan")]),
        ):
            with self.subTest(key=key, value=value):
                original = deepcopy(self.gold)
                self.gold["cases"][0][key] = value
                with self.assertRaises(EvaluationInputError):
                    self.score()
                self.gold = original


if __name__ == "__main__":
    unittest.main()
