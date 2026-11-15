"""Deterministic content hashing for Canonical packages.

Stable content identity per import-spec step 2: key order independent,
excludes runtime metadata (generated_at, imported_at) and the manifest
itself. Algorithm version is fixed and recorded in import reports.
"""
import hashlib
import json

CONTENT_HASH_VERSION = "content-hash-v1"

# Fixed file order pins the hash input; provenance/reports are internal and
# intentionally excluded so they cannot change content identity.
FILE_ORDER = (
    "exam.json",
    "sections.jsonl",
    "layers.jsonl",
    "question_types.jsonl",
    "units.jsonl",
    "questions.jsonl",
    "answer_keys.private.jsonl",
    "explanations.jsonl",
    "assets.jsonl",
)

_VOLATILE_FIELDS = frozenset({"generated_at", "imported_at"})


def canonical_json(value) -> str:
    return json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    )


def _strip_volatile(record: dict) -> dict:
    return {k: v for k, v in record.items() if k not in _VOLATILE_FIELDS}


def compute_content_hash(records_by_file: dict[str, list[dict]]) -> str:
    digest = hashlib.sha256()
    digest.update(CONTENT_HASH_VERSION.encode("utf-8"))
    digest.update(b"\x00")
    for filename in FILE_ORDER:
        for record in records_by_file.get(filename, []):
            digest.update(canonical_json(_strip_volatile(record)).encode("utf-8"))
            digest.update(b"\n")
    return digest.hexdigest()
