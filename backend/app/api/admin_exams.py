"""Admin exam / release management endpoints (ADR-0010: no review flow, so
the admin's lever is withdraw/restore). Every route needs an admin session;
the audit identity comes from the session, never from the request body."""
import json
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text

from app.admin_auth import admin_reviewer_id, require_admin
from app.db.engine import get_engine
from app.publisher import (ReleaseStateError, restore_release,
                           withdraw_release)

router = APIRouter()

_LIST_SQL = """
WITH shown AS (            -- the release each exam is shown with
  SELECT DISTINCT ON (r.exam_id) r.exam_id, r.id, r.revision, r.state,
         r.published_at, (c.release_id IS NOT NULL) AS is_current
    FROM exam_releases r
    LEFT JOIN exam_current_releases c ON c.exam_id = r.exam_id AND c.release_id = r.id
   ORDER BY r.exam_id, (c.release_id IS NOT NULL) DESC, r.revision DESC
), unit_counts AS (
  SELECT release_id, count(*) AS units,
         count(*) FILTER (WHERE conversion_status <> 'complete') AS hidden_units
    FROM release_units GROUP BY release_id
), q_counts AS (
  SELECT release_id, count(*) AS questions FROM release_questions GROUP BY release_id
), key_counts AS (
  SELECT release_id,
         count(*) FILTER (WHERE review_status NOT IN ('agent_verified','human_reviewed'))
           AS unverified FROM release_answer_keys GROUP BY release_id
), last_dec AS (
  SELECT DISTINCT ON (exam_id) exam_id, decision, reviewer_id, notes, decided_at
    FROM publication_decisions
   WHERE decision IN ('auto_published','approved','withdrawn','restored')
   ORDER BY exam_id, decided_at DESC
)
SELECT e.id AS exam_id, e.level, e.year, e.month, e.title,
       s.id AS release_id, s.revision, s.state, s.published_at, s.is_current,
       COALESCE(u.units, 0) AS units, COALESCE(u.hidden_units, 0) AS hidden_units,
       COALESCE(q.questions, 0) AS questions, COALESCE(k.unverified, 0) AS unverified,
       d.decision, d.reviewer_id, d.notes, d.decided_at
  FROM exam_catalogs e
  LEFT JOIN shown s ON s.exam_id = e.id
  LEFT JOIN unit_counts u ON u.release_id = s.id
  LEFT JOIN q_counts q ON q.release_id = s.id
  LEFT JOIN key_counts k ON k.release_id = s.id
  LEFT JOIN last_dec d ON d.exam_id = e.id
 ORDER BY e.level, e.year DESC, e.month DESC
"""


def _note(raw: str | None):
    if not raw:
        return None
    try:
        return json.loads(raw)
    except ValueError:
        return raw      # free-text reason (e.g. a withdraw reason)


def _status(row) -> str:
    if row["is_current"]:
        return "published"
    if row["state"] == "withdrawn":
        return "withdrawn"
    return "unpublished"


@router.get("/api/admin/exams")
def admin_list_exams(admin: dict = Depends(require_admin())) -> dict:
    with get_engine().connect() as conn:
        rows = conn.execute(text(_LIST_SQL)).mappings().all()
    exams = []
    for r in rows:
        exams.append({
            "exam_id": r["exam_id"], "level": r["level"], "year": r["year"],
            "month": r["month"], "title": r["title"], "status": _status(r),
            "release": None if r["release_id"] is None else {
                "id": str(r["release_id"]), "revision": r["revision"],
                "state": r["state"], "is_current": r["is_current"],
                "published_at": r["published_at"].isoformat() if r["published_at"] else None},
            "counts": {"units": r["units"], "hidden_units": r["hidden_units"],
                       "questions": r["questions"],
                       "unverified_answer_keys": r["unverified"]},
            "publication": None if r["decision"] is None else {
                "decision": r["decision"], "reviewer_id": r["reviewer_id"],
                "note": _note(r["notes"]),
                "decided_at": r["decided_at"].isoformat()},
        })
    return {"exams": exams}


@router.get("/api/admin/exams/{exam_id}/releases")
def admin_exam_releases(exam_id: str, admin: dict = Depends(require_admin())) -> dict:
    with get_engine().connect() as conn:
        if conn.execute(text("SELECT 1 FROM exam_catalogs WHERE id = :e"),
                        {"e": exam_id}).first() is None:
            raise HTTPException(status_code=404, detail="exam not found")
        rows = conn.execute(text(
            "SELECT r.id, r.revision, r.state, r.published_at,"
            " (c.release_id IS NOT NULL) AS is_current FROM exam_releases r"
            " LEFT JOIN exam_current_releases c ON c.release_id = r.id"
            " WHERE r.exam_id = :e ORDER BY r.revision DESC"), {"e": exam_id}).mappings().all()
    return {"releases": [{
        "id": str(r["id"]), "revision": r["revision"], "state": r["state"],
        "is_current": r["is_current"],
        "published_at": r["published_at"].isoformat() if r["published_at"] else None}
        for r in rows]}


class WithdrawBody(BaseModel):
    reason: str | None = None


def _release_action(fn, release_id: uuid.UUID, *args):
    try:
        return fn(get_engine(), str(release_id), *args)
    except ReleaseStateError as e:
        code = 404 if e.code == "not_found" else 409
        raise HTTPException(status_code=code, detail={"code": e.code, "message": str(e)})


@router.post("/api/admin/releases/{release_id}/withdraw")
def admin_withdraw(release_id: uuid.UUID, body: WithdrawBody | None = None,
                   admin: dict = Depends(require_admin())) -> dict:
    reason = (body.reason.strip() if body and body.reason else None) or None
    return _release_action(withdraw_release, release_id, admin_reviewer_id(admin), reason)


@router.post("/api/admin/releases/{release_id}/restore")
def admin_restore(release_id: uuid.UUID, admin: dict = Depends(require_admin())) -> dict:
    return _release_action(restore_release, release_id, admin_reviewer_id(admin))
