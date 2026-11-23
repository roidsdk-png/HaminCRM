"""Independent model-tool orchestration checks using scripted replies only."""

import json
import unittest
from unittest.mock import patch

from analytics.config import Settings
from analytics.contracts import RunRequest
from analytics.engine import Engine
from analytics.storage import AnalyticsError, dumps


class ScriptedToolProvider:
    def __init__(self, outputs):
        self.outputs = iter(outputs)
        self.messages = []

    def complete(self, messages, _run_id, _tools):
        self.messages.append(json.loads(dumps(messages)))
        return next(self.outputs)


def call_tool(name, arguments):
    return {
        "role": "assistant",
        "content": None,
        "tool_calls": [
            {
                "id": "call-" + name,
                "type": "function",
                "function": {"name": name, "arguments": dumps(arguments)},
            }
        ],
    }


def final_answer(text, claims=None):
    return {
        "role": "assistant",
        "content": dumps({"answer": text, "numericClaims": claims or []}),
    }


class ResearchOrchestrationReview(unittest.TestCase):
    def record(self, identifier, score):
        return {
            "id": identifier,
            "kind": "test",
            "source_id": "qa-source",
            "contact_id": identifier,
            "conversation_id": None,
            "role": "user",
            "occurred_at": 1795293000,
            "text": "روایت آزمایشی مرتبط با " + identifier,
            "metadata": {"testKey": "anxiety", "scores": {"anxiety": score}},
        }

    def research(self, records, outputs, previous=None):
        provider = ScriptedToolProvider(outputs)
        engine = Engine(None, provider, Settings())
        result = engine.research(
            records,
            RunRequest(kind="research"),
            "qa-run",
            lambda: None,
            lambda *_: None,
            [],
            previous,
        )
        return result, provider.messages

    def test_score_cohort_then_average_uses_selected_actual_records(self):
        records = [
            self.record("test:low", 2),
            self.record("test:middle", 4),
            self.record("test:high", 8),
        ]
        result, messages = self.research(
            records,
            [
                call_tool(
                    "select_records",
                    {
                        "conditions": [
                            {"field": "scores.anxiety", "operator": "gte", "value": 4}
                        ]
                    },
                ),
                call_tool(
                    "calculate", {"metric": "average", "field": "scores.anxiety"}
                ),
                final_answer(
                    "میانگین گروه انتخاب‌شده 6 است.",
                    [{"value": 6, "path": "calculations.0.totals.value"}],
                ),
            ],
        )
        self.assertEqual(json.loads(messages[1][-1]["content"])["selected"], 2)
        observed = json.loads(messages[2][-1]["content"])
        self.assertEqual(observed["totals"]["value"], 6)
        self.assertEqual(observed["totals"]["measured"], 2)
        self.assertEqual(observed["totals"]["missing"], 0)
        self.assertEqual(result["calculations"][0], observed)
        self.assertEqual(set(result["examinedIds"]), {"test:middle", "test:high"})

    def previous(self, record):
        return {
            "items": [
                {
                    "id": f"item-{i}",
                    "title": f"item-{i}",
                    "summary": "prior-story-sentinel",
                    "attribution": "self",
                    "reason": "QA",
                    "evidenceIds": [f"proof-{i}"],
                }
                for i in range(1, 8)
            ],
            "evidence": {
                "proof-7": {
                    "recordId": record["id"],
                    "field": "text",
                    "quote": record["text"],
                }
            },
        }

    def test_seventh_previous_item_includes_its_actual_proof(self):
        record = self.record("test:seventh", 8)
        result, messages = self.research(
            [record],
            [
                call_tool("read_previous_results", {"offset": 6, "limit": 1}),
                final_answer("روایت هفتم بر اساس شواهد موجود خوانده شد."),
            ],
            self.previous(record),
        )
        output = json.loads(messages[1][-1]["content"])
        self.assertEqual(len(output["items"]), 1)
        self.assertEqual(output["items"][0]["ordinal"], 7)
        self.assertEqual(output["items"][0]["evidence"][0]["quote"], record["text"])
        self.assertEqual(result["findings"][0]["record"]["id"], record["id"])

    def test_previous_item_outside_current_scope_never_reaches_model(self):
        record = self.record("test:outside", 8)
        _, messages = self.research(
            [self.record("test:inside", 2)],
            [
                call_tool("read_previous_results", {"offset": 6, "limit": 1}),
                final_answer("برای این دامنه شاهد مرتبط وجود ندارد."),
            ],
            self.previous(record),
        )
        self.assertNotIn("prior-story-sentinel", messages[1][-1]["content"])

    def test_unknown_research_tool_is_rejected_before_answer(self):
        with self.assertRaises(AnalyticsError) as raised:
            self.research([], [call_tool("read_unapproved_table", {})])
        self.assertEqual(raised.exception.code, "unknown_tool")

    def test_test_cohort_expands_to_verified_chat_records_then_counts(self):
        test = self.record("test:high", 8)
        test["metadata"]["verifiedIdentityId"] = "confirmed-person"
        message = {
            **self.record("message:matched", 0),
            "kind": "message",
            "source_id": "chat-source",
            "metadata": {"verifiedIdentityId": "confirmed-person"},
        }
        outside = {**message, "id": "message:outside", "metadata": {}}
        result, messages = self.research(
            [test, message, outside],
            [
                call_tool(
                    "select_records",
                    {
                        "conditions": [
                            {"field": "scores.anxiety", "operator": "gte", "value": 8}
                        ]
                    },
                ),
                call_tool("expand_cohort", {"targetKinds": ["message"]}),
                call_tool("get_statistics", {}),
                final_answer(
                    "گروه دارای 1 پیام است.",
                    [{"value": 1, "path": "statistics.totals.messages"}],
                ),
            ],
        )
        expanded = json.loads(messages[2][-1]["content"])
        self.assertEqual(expanded["recordIds"], ["message:matched"])
        self.assertEqual(result["statistics"]["totals"]["messages"], 1)

    def test_scan_frequencies_are_grounded_by_distinct_conversation_with_denominator(
        self,
    ):
        rows = []
        for index, conversation in enumerate(["one", "one", "two"]):
            rows.append(
                {
                    **self.record(f"message:{index}", 0),
                    "kind": "message",
                    "conversation_id": conversation,
                }
            )
        findings = [
            {"record": row, "quote": row["text"], "field": "text", "label": "تنهایی"}
            for row in rows[:2]
        ]
        with patch.object(Engine, "extract", return_value=(findings, 0)):
            result, messages = self.research(
                rows,
                [
                    call_tool("scan_records", {"criterion": "تنهایی"}),
                    final_answer(
                        "در 1 گفتگو، برابر با 50 درصد، این موضوع شاهد دارد.",
                        [
                            {"value": 1, "path": "calculations.0.groups.0.value"},
                            {"value": 50, "path": "calculations.0.groups.0.share"},
                        ],
                    ),
                ],
            )
        calculation = result["calculations"][0]
        self.assertEqual(calculation["unit"], "conversation")
        self.assertEqual(
            calculation["totals"],
            {"eligible": 2, "measured": 1, "missing": 1, "value": 1},
        )
        self.assertEqual(calculation["groups"][0]["value"], 1)
        self.assertEqual(
            json.loads(messages[1][-1]["content"])["calculationPath"], "calculations.0"
        )
