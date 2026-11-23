"""Content generation must use in-scope evidence and visible valid references."""

import unittest

from analytics.config import Settings
from analytics.contracts import RunRequest
from analytics.jobs import Jobs
from analytics.storage import AnalyticsError


class ContentProvider:
    def __init__(self, response):
        self.response = response
        self.called = False

    def json(self, *_):
        self.called = True
        return self.response


class ContentScopeTests(unittest.TestCase):
    evidence_id = "a" * 40
    other_id = "b" * 40

    def generate(self, response, records=None, format="article"):
        provider = ContentProvider(response)
        jobs = Jobs(Settings(), None, None, provider)
        jobs.evidence = lambda *_: {
            "id": self.evidence_id,
            "recordId": "message:allowed",
            "quote": "این روزها احساس تنهایی داشتم و 2 بار درباره آن صحبت کردم",
        }
        request = RunRequest(
            kind="content", format=format, evidenceIds=[self.evidence_id]
        )
        result = jobs._content(
            {"owner": "owner", "id": "run"},
            request,
            [{"id": "message:allowed"}] if records is None else records,
            None,
            lambda: None,
            lambda *_: None,
        )
        return result, provider

    def test_selected_evidence_must_remain_within_current_filters(self):
        with self.assertRaises(AnalyticsError) as raised:
            self.generate(
                {"answer": "unused", "citations": [self.evidence_id]}, records=[]
            )
        self.assertEqual(raised.exception.code, "evidence_outside_scope")

    def test_declared_citation_without_visible_reference_is_rejected(self):
        with self.assertRaises(AnalyticsError) as raised:
            self.generate(
                {"answer": "روایت دربارهٔ تنهایی است.", "citations": [self.evidence_id]}
            )
        self.assertEqual(raised.exception.code, "invalid_content_evidence")

    def test_unknown_inline_reference_cannot_hide_behind_valid_citation_list(self):
        with self.assertRaises(AnalyticsError):
            self.generate(
                {"answer": f"روایت [{self.other_id}]", "citations": [self.evidence_id]}
            )

    def test_malformed_citation_is_a_controlled_error(self):
        with self.assertRaises(AnalyticsError) as raised:
            self.generate({"answer": "روایت", "citations": [{}]})
        self.assertEqual(raised.exception.code, "invalid_content_evidence")

    def test_matching_visible_reference_and_source_number_are_accepted(self):
        result, provider = self.generate(
            {
                "answer": f"او 2 بار دربارهٔ تنهایی صحبت کرده است. [{self.evidence_id}]",
                "citations": [self.evidence_id],
            }
        )
        self.assertTrue(provider.called)
        self.assertEqual(result["evidence"][0]["id"], self.evidence_id)

    def test_story_has_server_generated_adaptation_notice(self):
        result, _ = self.generate(
            {
                "answer": f"داستانی برگرفته از یک احساس ثبت‌شده [{self.evidence_id}]",
                "citations": [self.evidence_id],
            },
            format="story",
        )
        self.assertIn("داستان اقتباسی", result["notice"])
        self.assertIn("تخیلی", result["notice"])
