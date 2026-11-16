"""Deterministic review-state resolution over content_reviews/content_issues.

Guarantees (M1.6):

- Ordering: review events are ordered by the database-assigned
  ``content_reviews.sequence`` (insertion order), never by ``checked_at``.
  Many records may share one timestamp; sequence decides the effective state.
- Blocking verdicts (needs_review/blocked/disputed) are tracked as rows in
  ``content_issues``. An ordinary Agent ``pass`` can never clear an open
  blocking issue or an unresolved human dispute: ``effective_status`` reports
  the blocking state regardless of later pass records.
- Clearing a block is an explicit act: a resolution review row bound to the
  original issue, the current content hash and evidence
  (``resolve_issue``), or an automatic revalidation resolution recorded by
  the data-quality sync (new content hash where the finding no longer fires).
- Hash scoping: states are per (record_type, canonical_id, content_hash).
  Verdicts bound to an old content hash never satisfy or override new
  content; issues found on old hashes stay open historically but do not
  block a different content hash.
"""
from datetime import datetime, timezone
import json
import uuid

from sqlalchemy import text
from sqlalchemy.engine import Engine

RULE_VERSION_REVIEW = "review-workflow-1.1.0"


# ------------------------------------------------------- effective state ----

def latest_review(conn, record_type: str, canonical_id: str,
                  content_hash: str, reviewer_type: str | None = None):
    """Latest review row by sequence (deterministic, timestamp-independent)."""
    sql = ("SELECT review_status, issue_id, reviewer_type, reviewer_id,"
           " evidence, sequence FROM content_reviews"
           " WHERE record_type = :rt AND canonical_id = :cid"
           " AND content_hash = :chash")
    params = {"rt": record_type, "cid": canonical_id, "chash": content_hash}
    if reviewer_type is not None:
        sql += " AND reviewer_type = :rtype"
        params["rtype"] = reviewer_type
    sql += " ORDER BY sequence DESC LIMIT 1"
    return conn.execute(text(sql), params).first()


def open_issues(conn, record_type: str, canonical_id: str, content_hash: str,
                severity: str | None = None) -> list:
    """Open issues for one canonical record at one content hash (by sequence)."""
    sql = ("SELECT id, issue_code, severity, rule_version, detail, opened_at"
           " FROM content_issues WHERE status = 'open'"
           " AND record_type = :rt AND canonical_id = :cid"
           " AND content_hash = :chash")
    params: dict = {"rt": record_type, "cid": canonical_id, "chash": content_hash}
    if severity is not None:
        sql += " AND severity = :sev"
        params["sev"] = severity
    sql += " ORDER BY opened_at, id"
    return conn.execute(text(sql), params).fetchall()


def effective_status(conn, record_type: str, canonical_id: str,
                     content_hash: str) -> dict:
    """Final valid state for one record at one content hash.

    Open blocking issues dominate (a later pass never auto-clears them);
    otherwise the latest review row by sequence decides; no record at all
    means 'unverified'.
    """
    blocking = open_issues(conn, record_type, canonical_id, content_hash,
                           severity="blocking")
    if blocking:
        return {"status": "blocked", "reason": "open_blocking_issue",
                "issues": [{"id": str(b.id), "code": b.issue_code}
                           for b in blocking]}
    row = latest_review(conn, record_type, canonical_id, content_hash)
    if row is None:
        return {"status": "unverified", "reason": "no_review", "issues": []}
    return {"status": row.review_status, "reason": "latest_by_sequence",
            "issues": []}


# ------------------------------------------------------------- issues -------

def raise_issue(conn, source: str, issue_code: str, record_type: str,
                canonical_id: str, content_hash: str, severity: str,
                rule_version: str, detail: dict | None = None) -> uuid.UUID:
    """Create or re-sight a trackable issue; idempotent per identity key.

    Returns the issue id and whether it is open; re-sighting an open issue
    refreshes last_seen/detail without creating a duplicate row.
    """
    iid = uuid.uuid4()
    row = conn.execute(text(
        "INSERT INTO content_issues (id, source, issue_code, record_type,"
        " canonical_id, content_hash, severity, rule_version, detail)"
        " VALUES (:id, :src, :code, :rt, :cid, :chash, :sev, :rv,"
        " CAST(:detail AS jsonb))"
        " ON CONFLICT (issue_code, record_type, canonical_id, content_hash,"
        " rule_version) DO UPDATE SET last_seen_at = now(),"
        " detail = EXCLUDED.detail"
        " RETURNING id, status"),
        {"id": iid, "src": source, "code": issue_code, "rt": record_type,
         "cid": canonical_id, "chash": content_hash, "sev": severity,
         "rv": rule_version,
         "detail": json.dumps(detail, ensure_ascii=False) if detail else None},
    ).first()
    return {"id": str(row.id), "status": row.status}


def resolve_issue(conn, issue_id: str, reviewer_id: str, content_hash: str,
                  evidence: dict, reviewer_type: str = "human",
                  review_status: str = "human_reviewed") -> dict:
    """Explicitly resolve one open issue.

    Records a resolution review row bound to the original issue, the current
    content hash and the supplied evidence, then closes the issue. Refuses
    issues that are already resolved; refuses a resolution that does not name
    the content hash it applies to (never implied).
    """
    if not content_hash:
        raise ValueError("resolve_issue requires an explicit content_hash")
    row = conn.execute(text(
        "SELECT record_type, canonical_id, content_hash, status, issue_code"
        " FROM content_issues WHERE id = :iid"), {"iid": issue_id}).first()
    if row is None:
        raise ValueError(f"issue {issue_id} not found")
    if row.status != "open":
        raise ValueError(f"issue {issue_id} already resolved; history preserved")

    seq = conn.execute(text(
        "INSERT INTO content_reviews (id, record_type, canonical_id,"
        " content_hash, reviewer_type, reviewer_id, review_status,"
        " evidence, checked_at, issue_id)"
        " VALUES (:id, :rt, :cid, :chash, :rtype, :rid, :status,"
        " CAST(:ev AS jsonb), :at, :iid) RETURNING sequence"),
        {"id": uuid.uuid4(), "rt": row.record_type, "cid": row.canonical_id,
         "chash": content_hash, "rtype": reviewer_type, "rid": reviewer_id,
         "status": review_status,
         "ev": json.dumps({"resolution_for": row.issue_code, **evidence},
                          ensure_ascii=False),
         "at": datetime.now(timezone.utc), "iid": issue_id}).scalar()

    conn.execute(text(
        "UPDATE content_issues SET status = 'resolved', resolved_at = now(),"
        " resolved_content_hash = :chash, resolved_by = :rid,"
        " resolution_evidence = CAST(:ev AS jsonb) WHERE id = :iid"),
        {"chash": content_hash, "rid": reviewer_id,
         "ev": json.dumps({"review_sequence": seq,
                           "review_status": review_status, **evidence},
                          ensure_ascii=False), "iid": issue_id})
    return {"ok": True, "issue_id": str(issue_id), "status": "resolved",
            "resolved_content_hash": content_hash}


def resolve_issue_engine(engine: Engine, issue_id: str, reviewer_id: str,
                         content_hash: str, evidence: dict,
                         reviewer_type: str = "human",
                         review_status: str = "human_reviewed") -> dict:
    with engine.begin() as conn:
        return resolve_issue(conn, issue_id, reviewer_id, content_hash,
                             evidence, reviewer_type, review_status)
