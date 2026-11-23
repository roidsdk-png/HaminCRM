"""Independent acceptance tests using synthetic records and no external model calls."""

import json
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient

from analytics.config import Settings
from analytics.contracts import Filters, RunRequest, SyncRequest
from analytics.corpus import Corpus
from analytics.engine import Engine
from analytics.privacy import redact, redact_text
from analytics.provider import Provider
from analytics.storage import AnalyticsError, Database


class PrivacyAcceptance(unittest.TestCase):
    def test_contacts_and_links_in_persian_free_text_are_redacted(self):
        original = (
            "علی رضایی گفت با ۰۹۱۲۱۲۳۴۵۶۷ و ٠٩١٣١٢٣٤٥٦٧ تماس بگیرید. "
            "ali@example.org https://example.org/profile/ali @ali_reza "
            "کد ملی ۱۲۳۴۵۶۷۸۹۰ و کارت ۶۰۳۷۹۹۱۲۳۴۵۶۷۸۹۰"
        )
        output = redact_text(original, ["علی رضایی"])
        for identifier in (
            "علی رضایی",
            "09121234567",
            "09131234567",
            "ali@example.org",
            "example.org",
            "@ali_reza",
            "1234567890",
            "6037991234567890",
        ):
            self.assertNotIn(identifier, output)
        self.assertIn("تماس بگیرید", output)

    def test_nested_payload_excludes_credentials_and_identifiers(self):
        output = redact(
            {
                "safe": {"scores": {"anxiety": 8}, "text": "تنهایی سخت بود"},
                "children": [{"phone": "09121234567", "answer": "ali@example.org"}],
                "fullName": "علی رضایی",
                "api_key": "secret-value",
                "externalUserId": "person-181",
                "ipHash": "network-fingerprint",
            }
        )
        serialized = json.dumps(output, ensure_ascii=False)
        for identifier in (
            "09121234567",
            "ali@example.org",
            "علی رضایی",
            "secret-value",
            "person-181",
            "network-fingerprint",
        ):
            self.assertNotIn(identifier, serialized)
        self.assertEqual(output["safe"]["scores"]["anxiety"], 8)
        self.assertEqual(output["safe"]["text"], "تنهایی سخت بود")

    def test_redaction_is_stable_on_repeated_processing(self):
        initial = redact_text(
            "علی رضایی با 09121234567 از ترس ازدواج گفت", ["علی رضایی"]
        )
        self.assertEqual(redact_text(initial, ["علی رضایی"]), initial)

    def test_known_names_match_common_arabic_persian_letter_variants(self):
        output = redact_text("علی رضایی از ترس ازدواج گفت", ["علي رضايي"])
        self.assertNotIn("علی رضایی", output)
        self.assertIn("ازدواج", output)


class ProviderBoundaryAcceptance(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="crm-analysis-provider-")
        self.db = Database("sqlite:///" + str(Path(self.temp.name) / "provider.sqlite"))
        self.settings = Settings(
            api_key="synthetic-test-key",
            model="synthetic-model",
            embedding_model="synthetic-embedding",
        )
        self.provider = Provider(self.settings, self.db)

    def tearDown(self):
        self.temp.cleanup()

    def fake_transport(self, payload):
        return patch(
            "analytics.provider.httpx.Client.post",
            return_value=httpx.Response(200, json=payload),
        )

    def test_protocol_names_and_output_cap_survive_text_redaction(self):
        tool = {
            "type": "function",
            "function": {
                "name": "search_records",
                "description": "Search allowed records",
                "parameters": {
                    "type": "object",
                    "properties": {"query": {"type": "string"}},
                },
            },
        }
        response = {
            "choices": [{"message": {"role": "assistant", "content": "{}"}}],
            "usage": {"prompt_tokens": 5, "completion_tokens": 2},
        }
        with self.fake_transport(response) as post:
            self.provider.complete(
                [
                    {
                        "role": "user",
                        "content": "با 09121234567 و ali@example.org تماس بگیر",
                    }
                ],
                tools=[tool],
            )
        outbound = post.call_args.kwargs["json"]
        self.assertEqual(
            outbound.get("max_completion_tokens"), self.settings.max_output_tokens
        )
        self.assertEqual(outbound["tools"][0]["function"]["name"], "search_records")
        self.assertNotIn("09121234567", outbound["messages"][0]["content"])
        self.assertNotIn("ali@example.org", outbound["messages"][0]["content"])

    def test_embeddings_send_redacted_text_and_reuse_exact_cache(self):
        with self.fake_transport(
            {"data": [{"embedding": [0.5, 0.25]}], "usage": {"total_tokens": 3}}
        ) as post:
            first = self.provider.embed("تماس 09121234567 و ali@example.org")
            second = self.provider.embed("تماس 09121234567 و ali@example.org")
        self.assertEqual(first, [0.5, 0.25])
        self.assertEqual(second, first)
        self.assertEqual(post.call_count, 1)
        sent = post.call_args.kwargs["json"]["input"]
        self.assertNotIn("09121234567", sent)
        self.assertNotIn("ali@example.org", sent)

    def test_malformed_model_json_is_rejected(self):
        response = {
            "choices": [
                {
                    "message": {
                        "role": "assistant",
                        "content": "A fabricated plain answer",
                    }
                }
            ]
        }
        with self.fake_transport(response):
            with self.assertRaises(AnalyticsError) as raised:
                self.provider.json("Return a JSON object", {"query": "synthetic"})
        self.assertEqual(raised.exception.code, "invalid_model_output")


class ExtractionAcceptance(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="crm-analysis-extraction-")
        self.db = Database(
            "sqlite:///" + str(Path(self.temp.name) / "extraction.sqlite")
        )
        self.corpus = Corpus(self.db)
        self.corpus.sync(
            SyncRequest.model_validate(
                {
                    "generation": "synthetic-generation",
                    "snapshotId": "synthetic-snapshot",
                    "sequence": 1,
                    "sources": [
                        {
                            "id": "qa-source",
                            "slug": "qa",
                            "name": "QA",
                            "kind": "chatbot",
                            "platform": "bale",
                        }
                    ],
                    "records": [
                        {
                            "id": "message:qa-one",
                            "kind": "message",
                            "sourceId": "qa-source",
                            "contactId": "qa-person",
                            "conversationId": "qa-conversation",
                            "role": "user",
                            "occurredAt": 1795293000,
                            "text": "بعد از مهاجرت چند ماه تنها بودم و سختی زیادی کشیدم.",
                            "metadata": {},
                        }
                    ],
                    "complete": True,
                }
            )
        )
        self.records = self.corpus.records(Filters())

    def tearDown(self):
        self.temp.cleanup()

    def finding(self, **changes):
        return {
            "recordId": "message:qa-one",
            "field": "text",
            "quote": "چند ماه تنها بودم",
            "label": "تنهایی",
            "title": "تنهایی پس از مهاجرت",
            "summary": "مخاطب از چند ماه تنهایی پس از مهاجرت گفت.",
            "attribution": "self",
            "reason": "روایت مستقیم زندگی",
            **changes,
        }

    def test_fabricated_quote_or_foreign_record_cannot_become_evidence(self):
        valid = self.finding()
        provider = type(
            "SyntheticProvider",
            (),
            {
                "json": lambda _self, *_args: {
                    "findings": [
                        valid,
                        self.finding(quote="اتفاقی که در متن وجود ندارد"),
                        self.finding(recordId="message:someone-else"),
                        self.finding(field="metadata.private"),
                    ]
                }
            },
        )()
        engine = Engine(self.corpus, provider, Settings())
        findings, rejected = engine.extract(
            self.records,
            RunRequest(kind="experiences"),
            "synthetic-run",
            lambda: None,
            lambda *_: None,
        )
        self.assertEqual(len(findings), 1)
        self.assertEqual(findings[0]["quote"], valid["quote"])
        self.assertEqual(rejected, 3)

    def test_hypothetical_narrative_is_excluded_from_real_experiences(self):
        provider = type(
            "SyntheticProvider",
            (),
            {
                "json": lambda _self, *_args: {
                    "findings": [self.finding(attribution="hypothetical")]
                }
            },
        )()
        engine = Engine(self.corpus, provider, Settings())
        findings, _ = engine.extract(
            self.records,
            RunRequest(kind="experiences"),
            "synthetic-run",
            lambda: None,
            lambda *_: None,
        )
        self.assertEqual(findings, [])

    def test_unknown_classification_label_is_rejected(self):
        provider = type(
            "SyntheticProvider",
            (),
            {
                "json": lambda _self, *_args: {
                    "findings": [
                        self.finding(field="text", label="تنهایی"),
                        self.finding(field="text", label="ساختگی"),
                    ]
                }
            },
        )()
        engine = Engine(self.corpus, provider, Settings())
        findings, rejected = engine.extract(
            self.records,
            RunRequest(kind="challenges", categories=["تنهایی"]),
            "synthetic-run",
            lambda: None,
            lambda *_: None,
        )
        self.assertEqual(len(findings), 1)
        self.assertEqual(rejected, 1)


class AnalyticsAcceptance(unittest.TestCase):
    def setUp(self):
        from analytics.app import create_app

        self.temp = tempfile.TemporaryDirectory(prefix="crm-analysis-acceptance-")
        self.settings = Settings(
            database_url="sqlite:///" + str(Path(self.temp.name) / "analytics.sqlite"),
            internal_token="qa-internal-token",
            api_key="",
            model="",
            worker_enabled=False,
        )
        self.app = create_app(self.settings)
        self.client = TestClient(self.app)
        self.client.__enter__()
        self.headers = {
            "Authorization": "Bearer qa-internal-token",
            "X-Analytics-Actor": "owner-one",
        }
        self.other_headers = {**self.headers, "X-Analytics-Actor": "owner-two"}

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.temp.cleanup()

    def get(self, path, filters=None, headers=None, **params):
        if filters is not None:
            params["filters"] = json.dumps(filters)
        return self.client.get(
            "/v1" + path, params=params, headers=headers or self.headers
        )

    def sync(
        self, records, *, snapshot="snapshot-one", sequence=1, complete=True, **extra
    ):
        return self.client.post(
            "/v1/sync",
            headers=self.headers,
            json={
                "generation": "generation-one",
                "snapshotId": snapshot,
                "sequence": sequence,
                "sources": [
                    {
                        "id": "source-a",
                        "slug": "bale-qa",
                        "name": "QA A",
                        "kind": "chatbot",
                        "platform": "bale",
                        "status": "active",
                    },
                    {
                        "id": "source-b",
                        "slug": "eitaa-qa",
                        "name": "QA B",
                        "kind": "chatbot",
                        "platform": "eitaa",
                        "status": "active",
                    },
                ],
                "records": records,
                "complete": complete,
                "redactionNames": ["علی رضایی"],
                **extra,
            },
        )

    def record(
        self,
        number,
        *,
        source="source-a",
        contact="person-one",
        conversation="conversation-one",
        role="user",
        timestamp=1795293000,
        text=None,
    ):
        return {
            "id": f"message:{number}",
            "kind": "message",
            "sourceId": source,
            "contactId": contact,
            "conversationId": conversation,
            "role": role,
            "occurredAt": timestamp,
            "text": text or f"تجربه زندگی و ترس ازدواج شماره {number}",
            "metadata": {"countable": True},
        }

    def totals(self, filters=None):
        response = self.get("/overview", filters)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["totals"]

    def test_all_data_endpoints_require_internal_authentication(self):
        for path in ("/overview", "/words", "/sessions", "/runs"):
            with self.subTest(path=path):
                response = self.client.get("/v1" + path)
                self.assertEqual(response.status_code, 401, response.text)
        response = self.client.post("/v1/sync", json={})
        self.assertEqual(response.status_code, 401, response.text)

    def test_public_health_reveals_no_credentials(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("qa-internal-token", response.text)

    def test_invalid_token_and_missing_actor_cannot_read_data(self):
        for headers in (
            {"Authorization": "Bearer wrong-token", "X-Analytics-Actor": "owner-one"},
            {"Authorization": "Bearer qa-internal-token"},
        ):
            response = self.client.get("/v1/overview", headers=headers)
            self.assertEqual(response.status_code, 401, response.text)

    def test_sync_retries_do_not_duplicate_data(self):
        records = [self.record(1), self.record(2)]
        self.assertEqual(self.sync(records).status_code, 200)
        first = self.totals()
        self.assertEqual(self.sync(records).status_code, 200)
        self.assertEqual(self.totals(), first)
        self.assertEqual(first["records"], 2)

    def test_same_identity_and_conversation_strings_across_sources_remain_distinct(
        self,
    ):
        records = [self.record(1), self.record(2, source="source-b")]
        self.assertEqual(self.sync(records).status_code, 200)
        totals = self.totals()
        self.assertEqual(totals["contacts"], 2)
        self.assertEqual(totals["conversations"], 2)

    def test_assistant_words_do_not_enter_default_audience_language(self):
        records = [
            self.record(1, text="تنهایی تنهایی"),
            self.record(2, role="assistant", text="هوشربات هوشربات"),
        ]
        self.assertEqual(self.sync(records).status_code, 200)
        response = self.get("/words")
        self.assertEqual(response.status_code, 200, response.text)
        terms = [item["term"] for item in response.json()["items"]]
        self.assertIn("تنهایی", terms)
        self.assertNotIn("هوشربات", terms)
        response = self.get("/words", {"roles": ["assistant"]})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertIn("هوشربات", [item["term"] for item in response.json()["items"]])

    def test_incomplete_snapshot_does_not_replace_active_dataset(self):
        self.assertEqual(self.sync([self.record(1)]).status_code, 200)
        self.assertEqual(
            self.sync(
                [self.record(2)], snapshot="snapshot-two", sequence=2, complete=False
            ).status_code,
            200,
        )
        self.assertEqual(self.totals()["records"], 1)
        self.assertEqual(
            self.sync(
                [self.record(3)], snapshot="snapshot-two", sequence=2, complete=True
            ).status_code,
            200,
        )
        self.assertEqual(self.totals()["records"], 2)

    def test_completed_replacement_removes_deleted_records(self):
        self.assertEqual(self.sync([self.record(1), self.record(2)]).status_code, 200)
        self.assertEqual(
            self.sync(
                [self.record(2)], snapshot="snapshot-two", sequence=2
            ).status_code,
            200,
        )
        self.assertEqual(self.totals()["records"], 1)

    def test_filtered_words_are_deterministic_counts(self):
        self.assertEqual(
            self.sync(
                [
                    self.record(1, text="تنهایی تنهایی", conversation="c1"),
                    self.record(2, text="تنهایی", conversation="c1"),
                    self.record(3, text="تنهایی", conversation="c2"),
                    self.record(4, text="تنهایی", source="source-b", conversation="c3"),
                ]
            ).status_code,
            200,
        )
        response = self.get("/words", {"sourceIds": ["source-a"]})
        self.assertEqual(response.status_code, 200, response.text)
        word = next(
            item for item in response.json()["items"] if item["term"] == "تنهایی"
        )
        self.assertEqual(word["occurrences"], 4)
        self.assertEqual(word["messages"], 3)
        self.assertEqual(word["conversations"], 2)

    def test_tehran_date_interval_includes_exact_start_and_excludes_next_day(self):
        start = int(datetime.fromisoformat("2026-11-22T00:00:00+03:30").timestamp())
        next_day = int(datetime.fromisoformat("2026-11-23T00:00:00+03:30").timestamp())
        self.assertEqual(
            self.sync(
                [
                    self.record(1, timestamp=start - 1),
                    self.record(2, timestamp=start),
                    self.record(3, timestamp=next_day - 1),
                    self.record(4, timestamp=next_day),
                ]
            ).status_code,
            200,
        )
        self.assertEqual(
            self.totals({"from": "2026-11-22", "to": "2026-11-22"})["records"], 2
        )

    def test_invalid_filter_range_is_rejected_even_for_empty_dataset(self):
        for filters in (
            {"from": "2026-02-30"},
            {"from": "2026-11-23", "to": "2026-11-22"},
            {"ageFrom": 45, "ageTo": 20},
        ):
            with self.subTest(filters=filters):
                response = self.get("/overview", filters)
                self.assertIn(response.status_code, (400, 422), response.text)

    def test_missing_model_is_explicit_and_deterministic_counts_stay_available(self):
        self.assertEqual(self.sync([self.record(1)]).status_code, 200)
        self.assertEqual(self.totals()["records"], 1)
        response = self.client.post(
            "/v1/runs", headers=self.headers, json={"kind": "emotions", "filters": {}}
        )
        self.assertEqual(response.status_code, 503, response.text)
        self.assertIn("model_not_configured", response.text)

    def test_sessions_are_private_to_the_verified_actor(self):
        response = self.client.post(
            "/v1/sessions", headers=self.headers, json={"title": "تحقیق مالک اول"}
        )
        self.assertEqual(response.status_code, 200, response.text)
        session_id = response.json()["id"]
        response = self.get("/sessions/" + session_id, headers=self.other_headers)
        self.assertIn(response.status_code, (403, 404), response.text)
        response = self.get("/sessions", headers=self.other_headers)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertNotIn(session_id, response.text)


if __name__ == "__main__":
    unittest.main()
