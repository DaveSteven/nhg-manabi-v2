"""Data-quality record sync: validator findings → trackable content_issues.

M1.6: structural and media anomalies found by the Canonical validator
(cue timeline problems, material-grouping anomalies, other explicit
structural findings) are synced as independent data-quality records bound to
the staged package's Canonical content hash and the validator rule version.

Guarantees:
- Idempotent: re-syncing the same package at the same content hash never
  creates duplicate rows (uq_content_issue_identity; re-sighting refreshes
  last_seen_at/detail only).
- Severity policy: known structural/media anomaly codes are 'blocking'
  (they refuse promotion via the publish gate); advisory findings are
  'warning'. Unknown codes default to blocking (fail-safe, not fail-open).
- Resolution: after content is fixed and re-staged under a new content hash
  (or a new rule version stops the finding), re-running the sync marks the
  stale finding resolved — bound to the original issue, the new content hash
  and the revalidation evidence. Raw audio/subtitles and immutable releases
  are never touched.
- The N4 confirmed cue-timeline problems (ly-14-u01/u04/u05, ly-15-u01:
  last cue beyond real audio per the 2026-11-15 ffprobe audit) sync as open
  blocking records and stay queryable until human resolution.
"""
import json
import re
import uuid

from sqlalchemy import text
from sqlalchemy.engine import Engine

from app.importer.errors import ImportError_ as CanonicalImportError
from app.publisher import _load_staged_package
from app.importer.validator import validate_package
from app.review_state import resolve_issue

RULE_VERSION_DQ = "dq-rules-1.0.0"

# Advisory findings: recorded, queryable, but not publish-blocking.
WARNING_CODES = {
    "cue_gap_large",      # 10-26s intro gaps, pattern-consistent (audit §3)
    "cue_index",
    "asset_unverified",   # media gate handles verification separately
    "unit_no_content",
    "provenance_missing",
}

_LOC_UNIT = re.compile(r"^.*?\.unit\[([^\]]+)\]")
_LOC_QUESTION = re.compile(r"^.*?\.question\[([^\]]+)\]")


class DataQualityError(CanonicalImportError):
    """Sync refused (unknown record layout etc.)."""


def _severity(code: str) -> str:
    return "warning" if code in WARNING_CODES else "blocking"


def _parse_issue(i) -> tuple[str, str, str]:
    """Validator Issue → (record_type, canonical_id, issue_code).

    Location forms: '<pkg>.unit[<id>]' (+ optional '.materials[...]' suffix),
    '<pkg>.question[<id>]' (+ suffix), or package-level ('<pkg>.exam', ...).
    """
    code, location = i.code, i.location
    m = _LOC_UNIT.match(location)
    if m:
        return "unit", m.group(1), code
    m = _LOC_QUESTION.match(location)
    if m:
        return "question", m.group(1), code
    return "exam", _exam_id_from_location(location), code


def _exam_id_from_location(location: str) -> str:
    return location.split(".", 1)[0]


def sync_data_quality(engine: Engine, package_id: str,
                      content_hash: str | None = None) -> dict:
    """Sync validator findings for one staged package into content_issues."""
    staged_hash, package = _load_staged_package(engine, package_id, content_hash)
    vr = validate_package(package)
    if vr.errors:
        from app.importer.errors import ValidationError
        raise ValidationError([i.as_dict() for i in vr.errors])

    exam_id = package.records["exam.json"][0]["id"]
    created, reseen = [], []
    found: set[tuple[str, str, str]] = set()
    with engine.begin() as conn:
        for issue in vr.warnings:
            record_type, canonical_id, code = _parse_issue(issue)
            found.add((record_type, canonical_id, code))
            detail = {"message": issue.message, "location": issue.location,
                      "source": "validator", "exam_id": exam_id}
            row = conn.execute(text(
                "INSERT INTO content_issues (id, source, issue_code,"
                " record_type, canonical_id, content_hash, severity,"
                " rule_version, detail)"
                " VALUES (:id, 'validator', :code, :rt, :cid, :chash, :sev,"
                " :rv, CAST(:detail AS jsonb))"
                " ON CONFLICT (issue_code, record_type, canonical_id,"
                " content_hash, rule_version) DO UPDATE SET"
                " last_seen_at = now(), detail = EXCLUDED.detail"
                " RETURNING id, (xmax = 0) AS inserted"),
                {"id": uuid.uuid4(), "code": code, "rt": record_type,
                 "cid": canonical_id, "chash": staged_hash,
                 "sev": _severity(code), "rv": RULE_VERSION_DQ,
                 "detail": json.dumps(detail, ensure_ascii=False)},
            ).first()
            (created if row.inserted else reseen).append(
                {"issue_id": str(row.id), "code": code,
                 "record_type": record_type, "canonical_id": canonical_id,
                 "severity": _severity(code)})

        # Resolution pass: open validator findings for this package that no
        # longer fire at the current content hash / rule version are marked
        # resolved — bound to the original issue and the new content hash.
        resolved = []
        prior_hashes = [r[0] for r in conn.execute(text(
            "SELECT DISTINCT content_hash FROM import_jobs"
            " WHERE package_id = :p"), {"p": package_id})]
        stale = conn.execute(text(
            "SELECT id, issue_code, record_type, canonical_id, content_hash"
            " FROM content_issues"
            " WHERE source = 'validator' AND status = 'open'"
            " AND rule_version = :rv AND content_hash = ANY(:hashes)"),
            {"rv": RULE_VERSION_DQ, "hashes": prior_hashes}).fetchall()
        for s in stale:
            if (s.record_type, s.canonical_id, s.issue_code) in found \
                    and s.content_hash == staged_hash:
                continue  # still present at the current hash: stays open
            resolve_issue(
                conn, str(s.id), reviewer_id=f"data_quality_sync/{s.id}",
                content_hash=staged_hash,
                evidence={"resolved_by": "revalidation",
                          "rule_version": RULE_VERSION_DQ,
                          "package_id": package_id,
                          "finding": {"code": s.issue_code,
                                      "record_type": s.record_type,
                                      "canonical_id": s.canonical_id,
                                      "original_content_hash": s.content_hash}},
                reviewer_type="system", review_status="agent_checked")
            resolved.append({"issue_id": str(s.id), "code": s.issue_code,
                             "canonical_id": s.canonical_id,
                             "original_content_hash": s.content_hash})

    return {
        "ok": True,
        "package_id": package_id,
        "content_hash": staged_hash,
        "rule_version": RULE_VERSION_DQ,
        "created_count": len(created),
        "reseen_count": len(reseen),
        "resolved_count": len(resolved),
        "created": created,
        "reseen": reseen,
        "resolved": resolved,
    }


def query_issues(engine: Engine, *, unit_id: str | None = None,
                 question_id: str | None = None,
                 question_type: str | None = None,
                 package_id: str | None = None,
                 severity: str | None = None,
                 status: str = "open",
                 code: str | None = None) -> list[dict]:
    """Query data-quality / review issues by unit, question, question type,
    severity or code. ``question_type`` resolves unit ids from the latest
    staged job of ``package_id`` (or every staged job when omitted)."""
    sql = ("SELECT id, source, issue_code, record_type, canonical_id,"
           " content_hash, severity, rule_version, detail, status,"
           " opened_at, last_seen_at, resolved_at, resolved_content_hash,"
           " resolved_by, resolution_evidence"
           " FROM content_issues WHERE status = :status")
    params: dict = {"status": status}
    canonical_ids: list[str] | None = None
    with engine.connect() as conn:
        if unit_id or question_id or question_type:
            canonical_ids = []
            if unit_id:
                canonical_ids.append(unit_id)
            if question_id:
                canonical_ids.append(question_id)
            if question_type:
                if package_id:
                    jobs = conn.execute(text(
                        "SELECT id FROM import_jobs WHERE package_id = :p"),
                        {"p": package_id}).fetchall()
                else:
                    jobs = conn.execute(text("SELECT id FROM import_jobs")).fetchall()
                for job in jobs:
                    rows = conn.execute(text(
                        "SELECT payload FROM import_records"
                        " WHERE job_id = :j AND record_type = 'unit'"),
                        {"j": job.id}).fetchall()
                    canonical_ids += [r.payload["id"] for r in rows
                                      if r.payload.get("question_type_id") == question_type]
            if not canonical_ids:
                return []
            sql += " AND canonical_id = ANY(:ids)"
            params["ids"] = canonical_ids
        if package_id and not canonical_ids:
            hashes = [r[0] for r in conn.execute(text(
                "SELECT DISTINCT content_hash FROM import_jobs WHERE package_id = :p"),
                {"p": package_id})]
            sql += " AND content_hash = ANY(:hashes)"
            params["hashes"] = hashes
        if severity:
            sql += " AND severity = :sev"
            params["sev"] = severity
        if code:
            sql += " AND issue_code = :code"
            params["code"] = code
        sql += " ORDER BY opened_at, canonical_id"
        return [dict(r._mapping) for r in conn.execute(text(sql), params).fetchall()]


if __name__ == "__main__":
    import argparse
    import json
    import sys

    parser = argparse.ArgumentParser(description="Data-quality record sync")
    sub = parser.add_subparsers(dest="command", required=True)
    p_sync = sub.add_parser("sync")
    p_sync.add_argument("package_id")
    p_query = sub.add_parser("query")
    p_query.add_argument("--package", dest="package_id")
    p_query.add_argument("--unit", dest="unit_id")
    p_query.add_argument("--severity")
    p_query.add_argument("--status", default="open")
    p_query.add_argument("--code")
    args = parser.parse_args()

    from app.db.engine import get_engine
    engine = get_engine()
    if args.command == "sync":
        report = sync_data_quality(engine, args.package_id)
        print(json.dumps(report, ensure_ascii=False, default=str))
        sys.exit(0 if report["ok"] else 1)
    rows = query_issues(engine, package_id=args.package_id, unit_id=args.unit_id,
                        severity=args.severity, status=args.status, code=args.code)
    print(json.dumps(rows, ensure_ascii=False, default=str))
