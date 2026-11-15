"""Staging writer: import_jobs + import_records + source_mappings, draft only.

Red lines enforced here:
- Single transaction per package; any failure rolls back everything and
  leaves a diagnostics file, never a partial import.
- Never writes published tables (exam_releases, release_*, registries).
- Re-importing identical content (same package_id + content_hash) is
  idempotent: returns the existing job and writes nothing.
"""
import hashlib
import json
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError

from app.importer.errors import StagingError, ValidationError
from app.importer.hashing import CONTENT_HASH_VERSION, compute_content_hash
from app.importer.reader import CanonicalPackage
from app.importer.validator import validate_package

IMPORTER_VERSION = "staging-importer+0.1.0"
DEFAULT_DIAGNOSTICS_DIR = Path(__file__).resolve().parents[3] / "data" / "import_reports"

# content files in stable order; (filename, canonical id field)
_RECORD_SOURCES = (
    ("exam.json", "id"),
    ("sections.jsonl", "id"),
    ("layers.jsonl", "id"),
    ("question_types.jsonl", "id"),
    ("units.jsonl", "id"),
    ("questions.jsonl", "id"),
    ("answer_keys.private.jsonl", "question_id"),
    ("explanations.jsonl", "id"),
    ("assets.jsonl", "id"),
)


@dataclass
class ImportResult:
    package_id: str
    content_hash: str
    job_id: str
    idempotent: bool
    state: str
    counts: dict
    warnings: list

    def as_dict(self) -> dict:
        return {
            "package_id": self.package_id,
            "content_hash": self.content_hash,
            "job_id": self.job_id,
            "idempotent": self.idempotent,
            "state": self.state,
            "counts": self.counts,
            "warning_count": len(self.warnings),
            "warnings": self.warnings,
        }


def _canonical_id(record: dict, id_field: str) -> str:
    return record.get(id_field) or record.get("id") or ""


def _write_diagnostics(diagnostics_dir: Path | None, package_id: str,
                       content_hash: str, message: str, errors: list) -> Path:
    ddir = diagnostics_dir or DEFAULT_DIAGNOSTICS_DIR
    ddir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = ddir / f"{package_id}-{stamp}.json"
    path.write_text(json.dumps({
        "package_id": package_id,
        "content_hash": content_hash,
        "failed_at": datetime.now(timezone.utc).isoformat(),
        "error": message,
        "validation_errors": errors,
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def stage_package(engine: Engine, package: CanonicalPackage,
                  diagnostics_dir: Path | None = None) -> ImportResult:
    """Validate and stage one package; idempotent on (package_id, content_hash)."""
    content_hash = compute_content_hash(package.records)
    result = stage_hashed_package(engine, package, content_hash, diagnostics_dir)
    return result


def stage_hashed_package(engine: Engine, package: CanonicalPackage,
                         content_hash: str, diagnostics_dir: Path | None = None) -> ImportResult:
    package_id = package.package_id

    with engine.connect() as conn:
        existing = conn.execute(
            text("SELECT id, state FROM import_jobs WHERE package_id = :p AND content_hash = :h"),
            {"p": package_id, "h": content_hash},
        ).first()
    if existing is not None:
        return ImportResult(
            package_id=package_id, content_hash=content_hash, job_id=str(existing.id),
            idempotent=True, state=existing.state, counts={}, warnings=[],
        )

    vr = validate_package(package)
    if vr.errors:
        raise ValidationError([i.as_dict() for i in vr.errors])

    warnings = [i.as_dict() for i in vr.warnings]
    manifest = package.manifest
    # Cross-check the converter's own content hash when present. Algorithms may
    # legitimately differ, so a mismatch is a warning, not a rejection.
    if manifest.get("content_hash") and manifest["content_hash"] != content_hash:
        warnings.append({
            "severity": "warning", "code": "manifest_hash_differs",
            "location": package_id,
            "message": f"manifest.content_hash={manifest['content_hash']!r} "
                       f"differs from importer {CONTENT_HASH_VERSION} hash",
        })

    report = {
        "hash_algorithm": CONTENT_HASH_VERSION,
        "importer_version": IMPORTER_VERSION,
        "converter_version": manifest.get("conversion_version"),
        "schema_version": package.schema_version,
        "source_archive_sha256": package.source_archive_sha256,
        "counts": vr.counts,
        "warnings": warnings,
        "published_tables_written": False,
    }

    try:
        with engine.begin() as conn:
            job_id = uuid.uuid4()
            conn.execute(text(
                "INSERT INTO import_jobs (id, package_id, content_hash, schema_version,"
                " converter_version, state, report)"
                " VALUES (:id, :p, :h, :sv, :cv, 'pending', CAST(:report AS jsonb))",
            ), {"id": job_id, "p": package_id, "h": content_hash,
                "sv": package.schema_version,
                "cv": manifest.get("conversion_version"),
                "report": json.dumps(report, ensure_ascii=False)})

            for filename, id_field in _RECORD_SOURCES:
                for record in package.records.get(filename, []):
                    canonical_id = _canonical_id(record, id_field)
                    record_issues = [
                        w for w in warnings if canonical_id in w["location"]
                    ]
                    status = "needs_review" if record_issues else "valid"
                    payload = json.dumps(record, ensure_ascii=False)
                    conn.execute(text(
                        "INSERT INTO import_records (job_id, record_type, canonical_id,"
                        " payload, payload_sha256, validation_status, issues)"
                        " VALUES (:job, :rt, :cid, CAST(:payload AS jsonb), :sha, :status,"
                        " CAST(:issues AS jsonb))",
                    ), {"job": job_id, "rt": record.get("record_type", "record"),
                        "cid": canonical_id, "payload": payload,
                        "sha": hashlib.sha256(payload.encode("utf-8")).hexdigest(),
                        "status": status,
                        "issues": json.dumps(record_issues, ensure_ascii=False) if record_issues else None})

            for p in package.provenance:
                # Mappings are a stable cross-job registry (unique per archive +
                # canonical id); identical rows from a revised package are fine.
                conn.execute(text(
                    "INSERT INTO source_mappings (source_system, source_archive_hash,"
                    " source_object_id, source_node_path, canonical_type, canonical_id,"
                    " raw_node_hash)"
                    " VALUES (:ss, :sah, :soi, :snp, :ct, :ci, :rnh)"
                    " ON CONFLICT ON CONSTRAINT uq_source_canonical DO NOTHING",
                ), {"ss": p.get("source_system", "unknown"),
                    "sah": package.source_archive_sha256,
                    "soi": p.get("source_object_id"),
                    "snp": p.get("source_node_path"),
                    "ct": p.get("canonical_type"),
                    "ci": p.get("canonical_id"),
                    "rnh": p.get("raw_node_hash")})

            conn.execute(text(
                "UPDATE import_jobs SET state = 'staged', completed_at = now()"
                " WHERE id = :id",
            ), {"id": job_id})

        return ImportResult(
            package_id=package_id, content_hash=content_hash, job_id=str(job_id),
            idempotent=False, state="staged", counts=vr.counts, warnings=warnings,
        )
    except IntegrityError as e:
        # Race: an identical job committed concurrently — treat as idempotent.
        with engine.connect() as conn:
            existing = conn.execute(
                text("SELECT id, state FROM import_jobs WHERE package_id = :p AND content_hash = :h"),
                {"p": package_id, "h": content_hash},
            ).first()
        if existing is not None:
            return ImportResult(
                package_id=package_id, content_hash=content_hash, job_id=str(existing.id),
                idempotent=True, state=existing.state, counts={}, warnings=[],
            )
        diag = _write_diagnostics(diagnostics_dir, package_id, content_hash, str(e), [])
        raise StagingError(f"staging insert failed: {e}", diag) from e
    except Exception as e:
        diag = _write_diagnostics(diagnostics_dir, package_id, content_hash, str(e), [])
        raise StagingError(f"staging transaction failed: {e}", diag) from e


def stage_archive(engine: Engine, packages: list[CanonicalPackage],
                  diagnostics_dir: Path | None = None) -> list[ImportResult]:
    return [stage_package(engine, p, diagnostics_dir) for p in packages]
