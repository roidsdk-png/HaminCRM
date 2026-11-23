"""Check a source export or Git index without printing credentials or personal data.

This is a bounded accidental-disclosure check, not proof that every secret is absent.
Run against the staging index immediately before committing a production snapshot.
"""

import argparse
import json
import os
import re
import subprocess
from pathlib import Path, PurePosixPath

PRIVATE_PARTS = {
    ".git",
    ".ssh",
    ".aws",
    ".codex",
    "node_modules",
    ".venv-analytics",
    "venv",
    "__pycache__",
    ".wrangler",
    ".next",
    ".vinext",
    "dist",
    ".sites-runtime",
    ".ruff_cache",
    ".pytest_cache",
}
PRIVATE_ROOTS = {"data", "backups", "analytics-data", "outputs", "work"}
ARCHIVE_ENDINGS = (".tar", ".tar.gz", ".tgz", ".zip", ".7z", ".rar", ".gz")
PRIVATE_ENDINGS = (
    ".sqlite",
    ".sqlite3",
    ".db",
    ".sqlite-wal",
    ".sqlite-shm",
    ".pem",
    ".p12",
    ".pfx",
    ".key",
    ".log",
    ".pyc",
)
EXAMPLE_NAMES = {
    ".env.example",
    ".env.sample",
    ".dev.vars.example",
    "analytics.env.example",
}
BINARY_ENDINGS = {
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".ico",
    ".webp",
    ".woff",
    ".woff2",
    ".ttf",
    ".otf",
}
PATTERNS = {
    "private-key": re.compile(
        rb"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----"
    ),
    "openai-key": re.compile(rb"\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{24,}"),
    "google-key": re.compile(rb"\bAIza[A-Za-z0-9_-]{30,}"),
    "github-key": re.compile(
        rb"\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})"
    ),
    "aws-access-key": re.compile(rb"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b"),
    "credential-in-url": re.compile(
        rb"(?:https?|postgres(?:ql)?|mysql)://[^\s/:\"']+:[^\s/@\"']{5,}@"
    ),
}
ASSIGNMENT = re.compile(
    r"(?im)^\s*(?:(?:const|let|var)\s+)?([A-Za-z_][A-Za-z0-9_]*(?:password|secret|token|api_?key)|password|secret|token|api_?key)\s*[:=]\s*([\"'])([^\r\n\"']{10,})\2"
)
SAFE_VALUE = re.compile(
    r"(?i)^(?:synthetic[-_ ]|test[-_ ]|example[-_ ]|placeholder|change[-_ ]?me|your[-_ ]|\$|<|\{|Bearer )"
)


def private_path(name):
    path = PurePosixPath(name.replace("\\", "/"))
    lower = str(path).lower()
    if path.is_absolute() or ".." in path.parts:
        return "unsafe-path"
    if path.name in EXAMPLE_NAMES:
        return None
    if (path.parts and path.parts[0].lower() in PRIVATE_ROOTS) or any(
        part.lower() in PRIVATE_PARTS for part in path.parts
    ):
        return "private-runtime-directory"
    if path.name.startswith(".env") or path.name in {
        ".dev.vars",
        "analytics.env",
        "analytics.env.local",
        "provider-settings.json",
        "id_rsa",
        "id_ed25519",
    }:
        return "private-configuration"
    if (
        lower.endswith(PRIVATE_ENDINGS + ARCHIVE_ENDINGS)
        or ".bak" in path.name.lower()
        or lower.endswith(".tsbuildinfo")
    ):
        return "backup-or-generated-file"
    return None


def inspect_content(name, content):
    findings = []
    fixture = any(
        part in {"tests", "fixtures"} for part in PurePosixPath(name).parts
    ) or PurePosixPath(name).name.startswith(("test-", "test_", "verify-"))
    for code, pattern in PATTERNS.items():
        for match in pattern.finditer(content):
            if fixture and code == "credential-in-url":
                credential = (
                    match.group()
                    .split(b"://", 1)[1]
                    .split(b":", 1)[1]
                    .rstrip(b"@")
                    .lower()
                )
                if credential in {
                    b"secret",
                    b"password",
                    b"synthetic",
                    b"example",
                    b"test-password",
                }:
                    continue
            findings.append(
                {
                    "path": name,
                    "line": content[: match.start()].count(b"\n") + 1,
                    "code": code,
                }
            )
    if Path(name).suffix.lower() in BINARY_ENDINGS:
        return findings
    try:
        text = content.decode("utf-8-sig")
    except UnicodeError:
        return findings + [{"path": name, "code": "unreviewed-binary"}]
    for match in ASSIGNMENT.finditer(text):
        variable, _, value = match.groups()
        if SAFE_VALUE.search(value) or fixture or variable.startswith("DEVELOPMENT_"):
            continue
        findings.append(
            {
                "path": name,
                "line": text[: match.start()].count("\n") + 1,
                "code": "review-literal-credential",
            }
        )
    return findings


def git_command(root, *arguments):
    process = subprocess.run(
        ["git", "-C", str(root), *arguments], check=False, capture_output=True
    )
    if process.returncode:
        raise RuntimeError(
            "Reading the Git index failed; inspect repository access locally."
        )
    return process.stdout


def inspect_tree(root, git_index=False):
    root = Path(root).resolve()
    findings, excluded, checked = [], [], 0
    modes = {}
    if git_index:
        names = []
        for entry in git_command(root, "ls-files", "--stage", "-z").split(b"\0"):
            if not entry:
                continue
            metadata, raw_name = entry.split(b"\t", 1)
            mode, _digest, stage = metadata.decode("ascii").split()
            name = raw_name.decode("utf-8")
            if stage != "0":
                findings.append({"path": name, "code": "unmerged-index-entry"})
                continue
            modes[name] = mode
            names.append(name)
    else:
        names = []
        for current, directories, filenames in os.walk(root, followlinks=False):
            folder = Path(current)
            retained = []
            for directory in directories:
                path = folder / directory
                name = path.relative_to(root).as_posix()
                code = private_path(name)
                if code:
                    excluded.append({"path": name, "code": code})
                elif path.is_symlink():
                    findings.append({"path": name, "code": "symlink-requires-review"})
                else:
                    retained.append(directory)
            directories[:] = retained
            names.extend(
                (folder / filename).relative_to(root).as_posix()
                for filename in filenames
            )
    for name in names:
        code = private_path(name)
        if code:
            (findings if git_index else excluded).append({"path": name, "code": code})
            continue
        path = root / name
        if path.is_symlink() or modes.get(name) == "120000":
            findings.append({"path": name, "code": "symlink-requires-review"})
            continue
        content = (
            git_command(root, "show", ":" + name) if git_index else path.read_bytes()
        )
        checked += 1
        if len(content) > 20_000_000:
            findings.append({"path": name, "code": "oversized-unreviewed-file"})
            continue
        findings.extend(inspect_content(name, content))
    return {
        "checkedFiles": checked,
        "excludedEntries": len(excluded),
        "findings": findings,
        "passed": not findings,
        "limitation": "Manual review and an explicit source-only manifest remain required; findings never include matched secret values.",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=".")
    parser.add_argument(
        "--git-index",
        action="store_true",
        help="Check the exact staged source; private/generated files fail instead of being skipped.",
    )
    args = parser.parse_args()
    try:
        result = inspect_tree(args.root, args.git_index)
    except (OSError, ValueError, RuntimeError):
        print(
            json.dumps(
                {
                    "passed": False,
                    "error": "Source check could not complete. Inspect local filesystem and Git access.",
                }
            )
        )
        return 2
    print(json.dumps(result, ensure_ascii=True, indent=2))
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
