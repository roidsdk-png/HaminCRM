"""Resolve trusted interpretation guides by explicit questionnaire version."""

import json
from pathlib import Path

from .privacy import redact


def _identifier(value):
    if isinstance(value, str) and value.strip() and len(value) <= 500:
        return value.strip()
    return None


def _version(value):
    if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
        return str(value)
    return _identifier(value)


def _has_source(value):
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, dict):
        return any(
            isinstance(value.get(key), str) and value[key].strip()
            for key in ("title", "reference", "url")
        )
    return False


def _validated(value):
    if not isinstance(value, dict):
        return None
    key = _identifier(value.get("testKey"))
    version = _version(value.get("version"))
    if not key or not version or not _has_source(value.get("source")):
        return None
    guide = {**value, "testKey": key, "version": version}
    try:
        json.dumps(guide, sort_keys=True, allow_nan=False)
    except (TypeError, ValueError):
        return None
    return guide


def _definition(guide):
    return json.dumps(
        {key: value for key, value in guide.items() if key != "trusted"},
        sort_keys=True,
        ensure_ascii=False,
        allow_nan=False,
    )


def load_guides(directory):
    """Return ``index[testKey][version]`` with ambiguous entries set to None.

    Files are trusted local configuration. An exact duplicate definition is
    harmless. Different definitions for one key and version remain ambiguous
    regardless of filename ordering.
    """
    root = Path(directory)
    index = {}
    definitions = {}
    if not root.is_dir():
        return index
    for path in sorted(root.glob("*.json")):
        try:
            if not path.is_file() or path.stat().st_size > 2_000_000:
                continue
            value = json.loads(path.read_text(encoding="utf-8-sig"))
        except (OSError, UnicodeError, ValueError):
            continue
        guide = _validated(value)
        if not guide:
            continue
        key, version = guide["testKey"], guide["version"]
        versions = index.setdefault(key, {})
        identity = (key, version)
        definition = _definition(guide)
        if identity in definitions and definitions[identity] != definition:
            versions[version] = None
            continue
        definitions.setdefault(identity, definition)
        if version not in versions:
            versions[version] = redact(guide)
    return index


def resolve_guide(record, index):
    """Return a matching trusted guide only when the record states its version."""
    metadata = record.get("metadata")
    if not isinstance(metadata, dict):
        return None
    key = _identifier(metadata.get("testKey"))
    explicit_versions = {
        version
        for value in (metadata.get("testVersion"), metadata.get("questionnaireVersion"))
        if (version := _version(value)) is not None
    }
    if not key or len(explicit_versions) != 1:
        return None
    version = explicit_versions.pop()
    versions = index.get(key, {})
    if version in versions and versions[version] is None:
        return None
    configured = versions.get(version)
    inline = _validated(metadata.get("guide"))
    if inline and (
        inline.get("trusted") is not True
        or inline["testKey"] != key
        or inline["version"] != version
    ):
        inline = None
    if configured:
        if inline and _definition(redact(inline)) != _definition(configured):
            return None
        return configured
    return redact(inline) if inline else None


def guide_catalog(index):
    """Build a stable JSON-compatible list of versions and ambiguous entries."""
    guides = []
    ambiguous = []
    for key in sorted(index):
        for version in sorted(index[key]):
            guide = index[key][version]
            if guide is None:
                ambiguous.append({"testKey": key, "version": version})
            else:
                guides.append(guide)
    return {"guides": guides, "ambiguous": ambiguous}
