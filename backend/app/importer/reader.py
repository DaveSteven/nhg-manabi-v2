"""Canonical package reader: zip or directory, manifest + checksum verification.

Rejects unreadable archives, wrong schema_version, checksum mismatches and
malformed JSONL before any validation or DB access (import-spec step 1).
"""
import hashlib
import json
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

from app.importer.errors import ChecksumError, PackageReadError

SUPPORTED_SCHEMA_VERSION = "2.0.0"

CONTENT_FILES = (
    "exam.json",
    "sections.jsonl",
    "layers.jsonl",
    "question_types.jsonl",
    "units.jsonl",
    "questions.jsonl",
    "answer_keys.private.jsonl",
)
REQUIRED_RECORD_FIELDS = ("record_type", "schema_version")
COUNT_KEYS = ("sections", "layers", "units", "questions", "assets")


@dataclass
class CanonicalPackage:
    package_id: str
    manifest: dict
    records: dict[str, list[dict]] = field(default_factory=dict)
    provenance: list[dict] = field(default_factory=list)
    source_archive_sha256: str = ""

    @property
    def schema_version(self) -> str:
        return self.manifest["schema_version"]


def _parse_jsonl_lenient(raw: bytes, name: str) -> list[dict]:
    """JSONL without per-record envelope fields (provenance rows)."""
    records = []
    for lineno, line in enumerate(raw.decode("utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError as e:
            raise PackageReadError(f"{name}:{lineno}: invalid JSON ({e})") from e
        if not isinstance(record, dict):
            raise PackageReadError(f"{name}:{lineno}: record must be a JSON object")
        records.append(record)
    return records


def _check_content_schema_version(records: list[dict], name: str) -> None:
    for i, record in enumerate(records):
        if record.get("schema_version") != SUPPORTED_SCHEMA_VERSION:
            raise PackageReadError(
                f"{name}[{i}]: record schema_version "
                f"{record.get('schema_version')!r} != {SUPPORTED_SCHEMA_VERSION!r}"
            )


def _parse_jsonl(raw: bytes, name: str) -> list[dict]:
    records = []
    text = raw.decode("utf-8")
    for lineno, line in enumerate(text.splitlines(), start=1):
        if not line.strip():
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError as e:
            raise PackageReadError(f"{name}:{lineno}: invalid JSON ({e})") from e
        if not isinstance(record, dict):
            raise PackageReadError(f"{name}:{lineno}: record must be a JSON object")
        for req in REQUIRED_RECORD_FIELDS:
            if req not in record:
                raise PackageReadError(f"{name}:{lineno}: missing '{req}'")
        if record["schema_version"] != SUPPORTED_SCHEMA_VERSION:
            raise PackageReadError(
                f"{name}:{lineno}: record schema_version "
                f"{record['schema_version']!r} != {SUPPORTED_SCHEMA_VERSION!r}"
            )
        records.append(record)
    return records


def _read_file_opener(open_binary):
    """Shared manifest/JSONL logic for zip entries and filesystem paths."""

    def read_bytes(name: str) -> bytes:
        return open_binary(name)

    def load(manifest_raw: bytes, prefix: str) -> CanonicalPackage:
        try:
            manifest = json.loads(manifest_raw)
        except json.JSONDecodeError as e:
            raise PackageReadError(f"{prefix}manifest.json: invalid JSON ({e})") from e
        if manifest.get("record_type") != "manifest":
            raise PackageReadError(f"{prefix}manifest.json: record_type must be 'manifest'")
        if manifest.get("schema_version") != SUPPORTED_SCHEMA_VERSION:
            raise PackageReadError(
                f"{prefix}manifest.json: schema_version "
                f"{manifest.get('schema_version')!r} != {SUPPORTED_SCHEMA_VERSION!r}"
            )
        for item in manifest.get("files", []):
            entry_name = prefix + item["path"]
            try:
                raw = read_bytes(entry_name)
            except (KeyError, FileNotFoundError, OSError) as e:
                raise ChecksumError(f"{entry_name}: listed in manifest but unreadable ({e})") from e
            if len(raw) != item["bytes"]:
                raise ChecksumError(
                    f"{entry_name}: byte count {len(raw)} != manifest {item['bytes']}"
                )
            actual = hashlib.sha256(raw).hexdigest()
            if actual != item["sha256"]:
                raise ChecksumError(
                    f"{entry_name}: sha256 {actual} != manifest {item['sha256']}"
                )

        records: dict[str, list[dict]] = {}
        for filename in ("exam.json", "sections.jsonl", "layers.jsonl",
                         "question_types.jsonl", "units.jsonl", "questions.jsonl",
                         "answer_keys.private.jsonl", "explanations.jsonl",
                         "assets.jsonl"):
            try:
                raw = read_bytes(prefix + filename)
            except (KeyError, FileNotFoundError, OSError):
                if filename in CONTENT_FILES:
                    raise PackageReadError(f"{prefix}{filename}: required content file missing")
                records[filename] = []
                continue
            if filename.endswith(".jsonl"):
                records[filename] = _parse_jsonl(raw, prefix + filename)
            else:
                try:
                    parsed = json.loads(raw)
                except json.JSONDecodeError as e:
                    raise PackageReadError(f"{prefix}{filename}: invalid JSON ({e})") from e
                records[filename] = [parsed]
                _check_content_schema_version(records[filename], prefix + filename)

        manifest_counts = manifest.get("counts", {})
        actual_counts = {
            "sections": len(records["sections.jsonl"]),
            "layers": len(records["layers.jsonl"]),
            "units": len(records["units.jsonl"]),
            "questions": len(records["questions.jsonl"]),
            "assets": len(records["assets.jsonl"]),
        }
        for key in COUNT_KEYS:
            if key in manifest_counts and manifest_counts[key] != actual_counts[key]:
                raise PackageReadError(
                    f"{prefix}manifest.json: counts.{key}={manifest_counts[key]} "
                    f"but actual rows={actual_counts[key]}"
                )

        try:
            provenance_raw = read_bytes(prefix + "provenance/source_refs.private.jsonl")
            provenance = _parse_jsonl_lenient(
                provenance_raw, prefix + "provenance/source_refs.private.jsonl")
        except (KeyError, FileNotFoundError, OSError):
            provenance = []

        package_id = manifest.get("package_id")
        if not package_id:
            raise PackageReadError(f"{prefix}manifest.json: missing package_id")

        return CanonicalPackage(
            package_id=package_id,
            manifest=manifest,
            records=records,
            provenance=provenance,
            source_archive_sha256=manifest.get("source_archive_sha256", ""),
        )

    return load


def _find_package_prefixes(names: list[str]) -> list[str]:
    prefixes = sorted({
        p.rsplit("/", 1)[0] + "/"
        for p in names
        if p.endswith("manifest.json") and "/" in p
    })
    if "manifest.json" in names:
        prefixes.insert(0, "")
    return prefixes


def load_archive(path: Path) -> list[CanonicalPackage]:
    """Load one or more Canonical packages from a .zip or a directory."""
    path = Path(path)
    if not path.exists():
        raise PackageReadError(f"{path}: does not exist")

    if path.is_file():
        if path.suffix.lower() != ".zip":
            raise PackageReadError(f"{path}: single-file input must be a .zip")
        try:
            with zipfile.ZipFile(path) as z:
                names = z.namelist()

                def open_binary(name: str) -> bytes:
                    return z.read(name)

                load = _read_file_opener(open_binary)
                prefixes = _find_package_prefixes(names)
                if not prefixes:
                    raise PackageReadError(f"{path}: no manifest.json found in archive")
                return [load(open_binary(p + "manifest.json"), p) for p in prefixes]
        except zipfile.BadZipFile as e:
            raise PackageReadError(f"{path}: not a valid zip archive ({e})") from e

    if path.is_dir():
        if (path / "manifest.json").is_file():
            def open_binary(name: str) -> bytes:
                return (path / name).read_bytes()

            load = _read_file_opener(open_binary)
            return [load(b"", "")]
        subdirs = sorted(p for p in path.iterdir() if p.is_dir() and (p / "manifest.json").is_file())
        if not subdirs:
            raise PackageReadError(f"{path}: no manifest.json found in directory tree")
        packages = []
        for sub in subdirs:
            packages.extend(load_archive(sub))
        return packages

    raise PackageReadError(f"{path}: not a file or directory")
