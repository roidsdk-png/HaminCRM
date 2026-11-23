"""Versioned questionnaire interpretation must preserve its provenance."""

import json
import tempfile
import unittest
from pathlib import Path

from analytics.config import Settings
from analytics.engine import Engine, record_fields
from analytics.guides import guide_catalog, load_guides, resolve_guide


def guide(version="1", **changes):
    return {
        "testKey": "synthetic-anxiety",
        "version": version,
        "title": "راهنمای آزمایشی اضطراب",
        "source": {"title": "Synthetic manual", "reference": "manual-v" + str(version)},
        "scales": {"anxiety": {"maximum": 20}},
        **changes,
    }


def record(version="1", **changes):
    return {
        "metadata": {"testKey": "synthetic-anxiety", "testVersion": version, **changes}
    }


class VersionedGuideTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="crm-guide-tests-")
        self.root = Path(self.temporary.name)

    def tearDown(self):
        self.temporary.cleanup()

    def write(self, name, value):
        (self.root / name).write_text(
            json.dumps(value, ensure_ascii=False), encoding="utf-8-sig"
        )

    def test_old_and_new_versions_resolve_independently(self):
        self.write("old.json", guide("1"))
        self.write("new.json", guide("2", scales={"anxiety": {"maximum": 40}}))
        index = load_guides(self.root)
        self.assertEqual(
            resolve_guide(record("1"), index)["scales"]["anxiety"]["maximum"], 20
        )
        self.assertEqual(
            resolve_guide(record("2"), index)["scales"]["anxiety"]["maximum"], 40
        )

    def test_unknown_or_missing_version_never_chooses_the_only_available_guide(self):
        self.write("one.json", guide())
        index = load_guides(self.root)
        self.assertIsNone(resolve_guide(record("unknown"), index))
        self.assertIsNone(resolve_guide(record(None), index))
        self.assertIsNone(
            resolve_guide({"metadata": {"testKey": "synthetic-anxiety"}}, index)
        )

    def test_questionnaire_version_alias_and_numeric_version_are_supported(self):
        self.write("one.json", guide(1))
        index = load_guides(self.root)
        actual = {
            "metadata": {"testKey": "synthetic-anxiety", "questionnaireVersion": 1}
        }
        self.assertEqual(resolve_guide(actual, index)["version"], "1")

    def test_conflicting_record_version_aliases_are_unresolved(self):
        self.write("one.json", guide("1"))
        index = load_guides(self.root)
        self.assertIsNone(resolve_guide(record("1", questionnaireVersion="2"), index))

    def test_conflicting_duplicate_definitions_remain_ambiguous(self):
        self.write("a.json", guide())
        self.write("b.json", guide(scales={"anxiety": {"maximum": 99}}))
        self.write("c.json", guide())
        index = load_guides(self.root)
        self.assertIn("1", index["synthetic-anxiety"])
        self.assertIsNone(index["synthetic-anxiety"]["1"])
        self.assertIsNone(resolve_guide(record(), index))
        self.assertEqual(
            guide_catalog(index),
            {
                "guides": [],
                "ambiguous": [{"testKey": "synthetic-anxiety", "version": "1"}],
            },
        )

    def test_identical_duplicate_files_do_not_create_ambiguity(self):
        self.write("a.json", guide())
        self.write("b.json", guide())
        self.assertEqual(
            resolve_guide(record(), load_guides(self.root))["version"], "1"
        )

    def test_invalid_json_missing_provenance_and_nonfinite_values_are_ignored(self):
        (self.root / "broken.json").write_text("{invalid", encoding="utf-8")
        for index, value in enumerate(
            [
                guide(source=""),
                guide(source={}),
                guide(testKey=""),
                guide(version=""),
                guide(version=True),
                guide(scales={"anxiety": float("nan")}),
                [guide()],
            ]
        ):
            self.write(f"invalid-{index}.json", value)
        self.assertEqual(load_guides(self.root), {})

    def test_sensitive_metadata_is_redacted_while_title_is_preserved(self):
        self.write("one.json", guide(api_key="secret", author={"phone": "09121234567"}))
        resolved = resolve_guide(record(), load_guides(self.root))
        self.assertEqual(resolved["title"], "راهنمای آزمایشی اضطراب")
        self.assertNotIn("api_key", resolved)
        self.assertNotIn("09121234567", json.dumps(resolved))

    def test_inline_guide_requires_trust_exact_identity_and_provenance(self):
        self.assertIsNone(resolve_guide(record(guide=guide()), {}))
        self.assertIsNone(resolve_guide(record(guide=guide("2", trusted=True)), {}))
        self.assertIsNone(
            resolve_guide(record(guide=guide(testKey="another", trusted=True)), {})
        )
        self.assertIsNone(
            resolve_guide(record(guide=guide(source="", trusted=True)), {})
        )
        self.assertEqual(
            resolve_guide(record(guide=guide(trusted=True)), {})["version"], "1"
        )

    def test_matching_inline_guide_cannot_override_an_ambiguous_file_definition(self):
        index = {"synthetic-anxiety": {"1": None}}
        self.assertIsNone(resolve_guide(record(guide=guide(trusted=True)), index))

    def test_conflicting_inline_definition_invalidates_interpretation(self):
        self.write("one.json", guide())
        index = load_guides(self.root)
        self.assertIsNone(
            resolve_guide(
                record(guide=guide(trusted=True, scales={"anxiety": {"maximum": 99}})),
                index,
            )
        )

    def test_catalog_order_is_deterministic(self):
        self.write("z.json", guide("2"))
        self.write("a.json", guide("1"))
        catalog = guide_catalog(load_guides(self.root))
        self.assertEqual([item["version"] for item in catalog["guides"]], ["1", "2"])
        self.assertEqual(catalog["ambiguous"], [])

    def test_extraction_batches_expose_only_exact_version_resolved_guide(self):
        self.write("one.json", guide("1"))
        self.write("two.json", guide("2", title="other-version-sentinel"))
        engine = Engine(None, None, Settings(guides_dir=str(self.root)))
        actual = {
            "id": "test:one",
            "source_id": "test-source",
            "kind": "test",
            "role": "user",
            "conversation_id": None,
            "text": "پاسخ واقعی",
            **record("1"),
        }
        batch = list(engine.batches([actual], False))[0]
        self.assertEqual(batch[0]["guide"]["version"], "1")
        self.assertNotIn(
            "other-version-sentinel", json.dumps(batch, ensure_ascii=False)
        )
        actual["metadata"]["testVersion"] = "unknown"
        self.assertIsNone(list(engine.batches([actual], False))[0][0]["guide"])

    def test_untrusted_inline_guide_is_not_exposed_as_quoted_source_fields(self):
        actual = {
            "id": "test:one",
            "source_id": "test-source",
            "kind": "test",
            "role": "user",
            "conversation_id": None,
            "text": "پاسخ واقعی",
            **record(guide=guide(title="untrusted-guide-sentinel")),
        }
        engine = Engine(None, None, Settings(guides_dir=str(self.root)))
        batch = list(engine.batches([actual], False))[0]
        self.assertIsNone(batch[0]["guide"])
        self.assertNotIn("untrusted-guide-sentinel", json.dumps(batch))
        self.assertNotIn("metadata.guide.title", record_fields(actual))


if __name__ == "__main__":
    unittest.main()
