"""Disclosure checks must fail safely without printing matched secret values."""

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location(
    "release_check", Path(__file__).with_name("release-source-check.py")
)
CHECK = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CHECK)


class ReleaseSourceChecks(unittest.TestCase):
    def test_private_paths_are_blocked_but_source_routes_and_catalogs_are_allowed(self):
        for name in (
            ".dev.vars",
            ".env.production",
            "data/a.sqlite",
            "backups/complete.tar.gz",
            "analytics-data/provider-settings.json",
            "app/a.tsx.bak_123",
            "../escape",
        ):
            self.assertIsNotNone(CHECK.private_path(name), name)
        for name in (
            "app/api/admin/backups/route.ts",
            "lib/data/iran-locations.json",
            "analytics.env.example",
            ".dev.vars.example",
        ):
            self.assertIsNone(CHECK.private_path(name), name)

    def test_high_confidence_keys_are_reported_without_value(self):
        key = "sk-" + "a" * 32
        result = CHECK.inspect_content(
            "app/settings.ts", ("\nconst key = '" + key + "';").encode()
        )
        self.assertEqual(result[0]["line"], 2)
        self.assertEqual(result[0]["code"], "openai-key")
        self.assertNotIn(key, json.dumps(result))

    def test_synthetic_assignment_is_distinct_from_unknown_literal(self):
        self.assertEqual(
            CHECK.inspect_content(
                "settings.py", b"API_KEY = 'synthetic-test-only-key'"
            ),
            [],
        )
        findings = CHECK.inspect_content(
            "settings.py", b"PASSWORD = 'unreviewed-value-123' "
        )
        self.assertEqual(findings[0]["code"], "review-literal-credential")

    def test_runtime_tree_is_pruned_and_unreviewed_binary_fails(self):
        with tempfile.TemporaryDirectory(prefix="source-release-") as folder:
            root = Path(folder)
            (root / "data").mkdir()
            (root / "data" / "private.sqlite").write_bytes(b"sensitive-data")
            (root / "file.py").write_text("print('safe')", encoding="utf-8")
            self.assertTrue(CHECK.inspect_tree(root)["passed"])
            (root / "unknown.bin").write_bytes(b"\xff\xfe\x80")
            self.assertFalse(CHECK.inspect_tree(root)["passed"])

    def test_git_index_symlink_is_rejected_even_without_a_working_file(self):
        with tempfile.TemporaryDirectory(prefix="index-release-") as folder:
            staged = b"120000 " + b"a" * 40 + b" 0\tlink-to-private\0"
            with patch.object(CHECK, "git_command", return_value=staged) as command:
                result = CHECK.inspect_tree(folder, git_index=True)
            self.assertFalse(result["passed"])
            self.assertEqual(result["findings"][0]["code"], "symlink-requires-review")
            self.assertEqual(command.call_count, 1)


if __name__ == "__main__":
    unittest.main()
