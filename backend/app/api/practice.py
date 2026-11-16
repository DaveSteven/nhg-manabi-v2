"""Practice session management (M2 Task 04).

Uses the existing study_sessions / study_session_units tables:

- One active practice session per user, enforced by the DB partial unique
  index `ux_one_active_practice` AND a pre-check that returns the conflicting
  session id so the frontend can ask "continue or end the old one?".
- Session units are pinned to a concrete release_id at creation time, so a
  later publish never changes what an in-progress session refers to.
- Every route resolves the caller via get_current_user_id and scopes reads
  and writes to that identity; a session owned by someone else is 404.
- Nothing here ever returns correct answers or explanations (Task 07 will
  govern the feedback boundary).
"""
import json
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.auth import get_current_user_id
from app.db.engine import get_engine

router = APIRouter()

MAX_SESSION_UNITS = 100


class SessionUnitRequest(BaseModel):
    release_id: uuid.UUID
    unit_id: str


class PracticeSessionCreate(BaseModel):
    feedback_mode: Literal["immediate", "end"]
    units: list[SessionUnitRequest]

    @field_validator("units")
    @classmethod
    def units_not_empty(cls, v: list[SessionUnitRequest]) -> list[SessionUnitRequest]:
        if not v:
            raise ValueError("at least one unit is required")
        if len(v) > MAX_SESSION_UNITS:
            raise ValueError(f"at most {MAX_SESSION_UNITS} units per session")
        seen = {(str(u.release_id), u.unit_id) for u in v}
        if len(seen) != len(v):
            raise ValueError("duplicate units in request")
        return v


def _session_payload(conn, session_id: uuid.UUID) -> dict | None:
    head = conn.execute(text(
        "SELECT id, mode, feedback_mode, state, config, version,"
        " created_at, ended_at FROM study_sessions WHERE id = :s"),
        {"s": session_id}).mappings().first()
    if head is None:
        return None
    units = conn.execute(text(
        "SELECT id, release_id, unit_id, position, state, submitted_at"
        " FROM study_session_units WHERE session_id = :s ORDER BY position"),
        {"s": session_id}).mappings().all()
    return {
        "id": str(head["id"]), "mode": head["mode"],
        "feedback_mode": head["feedback_mode"], "state": head["state"],
        "config": head["config"], "version": head["version"],
        "created_at": head["created_at"].isoformat(),
        "ended_at": (head["ended_at"].isoformat()
                     if head["ended_at"] else None),
        "units": [{
            "id": str(u["id"]), "release_id": str(u["release_id"]),
            "unit_id": u["unit_id"], "position": u["position"],
            "state": u["state"],
            "submitted_at": (u["submitted_at"].isoformat()
                             if u["submitted_at"] else None),
        } for u in units],
    }


def _load_owned_session(conn, session_id: uuid.UUID,
                        user_id: uuid.UUID) -> dict | None:
    """Session header owned by user_id; 404-worthy when missing/foreign."""
    return conn.execute(text(
        "SELECT id, state, version FROM study_sessions"
        " WHERE id = :s AND user_id = :u"),
        {"s": session_id, "u": user_id}).mappings().first()


@router.post("/api/practice/sessions", status_code=201)
def create_practice_session(
    body: PracticeSessionCreate,
    user_id: uuid.UUID = Depends(get_current_user_id),
) -> dict:
    engine = get_engine()
    try:
        return _create_session_tx(engine, body, user_id)
    except IntegrityError:
        # Lost a race against a concurrent create for the same user: the
        # partial unique index ux_one_active_practice rejected us.
        raise HTTPException(
            status_code=409,
            detail={"code": "active_session_exists",
                    "message": "an active practice session already exists"})


def _create_session_tx(engine, body: PracticeSessionCreate,
                       user_id: uuid.UUID) -> dict:
    with engine.begin() as conn:
        active = conn.execute(text(
            "SELECT id FROM study_sessions"
            " WHERE user_id = :u AND mode = 'practice'"
            " AND state = 'in_progress'"),
            {"u": user_id}).scalar()
        if active is not None:
            raise HTTPException(
                status_code=409,
                detail={"code": "active_session_exists",
                        "message": "an active practice session already exists",
                        "active_session_id": str(active)})

        # Pin every requested unit to its CURRENT published release content.
        # Draft / non-current releases must not enter a practice session.
        metas = []
        for req in body.units:
            meta = conn.execute(text(
                "SELECT u.unit_id, u.layer_id, u.question_type_id,"
                " r.exam_id, r.id AS release_id,"
                " (SELECT count(*) FROM release_questions q"
                "  WHERE q.release_id = u.release_id"
                "    AND q.unit_id = u.unit_id) AS question_count"
                " FROM release_units u"
                " JOIN exam_releases r ON r.id = u.release_id"
                " JOIN exam_current_releases c ON c.release_id = r.id"
                " WHERE u.release_id = :r AND u.unit_id = :uid"
                "   AND r.state = 'published'"
                "   AND u.conversion_status = 'complete'"),
                {"r": req.release_id, "uid": req.unit_id}).mappings().first()
            if meta is None:
                raise HTTPException(
                    status_code=422,
                    detail={"code": "unit_not_available",
                            "message": "unit is not available for practice",
                            "release_id": str(req.release_id),
                            "unit_id": req.unit_id})
            metas.append(meta)

        session_id = conn.execute(text(
            "INSERT INTO study_sessions (id, user_id, mode, feedback_mode,"
            " state, mock_release_id, config)"
            " VALUES (gen_random_uuid(), :u, 'practice', :f,"
            " 'in_progress', NULL, CAST(:cfg AS jsonb)) RETURNING id"),
            {"u": user_id, "f": body.feedback_mode,
             "cfg": json.dumps({
                 "requested_units": [
                     {"release_id": str(u.release_id), "unit_id": u.unit_id}
                     for u in body.units]})}).scalar()
        for pos, meta in enumerate(metas, start=1):
            conn.execute(text(
                "INSERT INTO study_session_units (id, session_id, release_id,"
                " unit_id, position, state)"
                " VALUES (gen_random_uuid(), :s, :r, :uid, :p, 'pending')"),
                {"s": session_id, "r": meta["release_id"],
                 "uid": meta["unit_id"], "p": pos})
        payload = _session_payload(conn, session_id)
        payload["units_meta"] = [{
            "release_id": str(m["release_id"]), "unit_id": m["unit_id"],
            "layer_id": m["layer_id"], "question_type_id": m["question_type_id"],
            "exam_id": m["exam_id"], "question_count": m["question_count"],
        } for m in metas]
    return payload


@router.get("/api/practice/sessions/current")
def get_current_practice_session(
    user_id: uuid.UUID = Depends(get_current_user_id),
) -> dict:
    with get_engine().connect() as conn:
        session_id = conn.execute(text(
            "SELECT id FROM study_sessions"
            " WHERE user_id = :u AND mode = 'practice'"
            " AND state = 'in_progress'"), {"u": user_id}).scalar()
        if session_id is None:
            raise HTTPException(status_code=404, detail="no active practice")
        payload = _session_payload(conn, session_id)
    return payload


@router.get("/api/practice/sessions/{session_id}")
def get_practice_session(
    session_id: uuid.UUID,
    user_id: uuid.UUID = Depends(get_current_user_id),
) -> dict:
    with get_engine().connect() as conn:
        owned = _load_owned_session(conn, session_id, user_id)
        if owned is None:
            # Not found OR owned by someone else: identical response, so the
            # existence of other users' sessions never leaks.
            raise HTTPException(status_code=404, detail="session not found")
        payload = _session_payload(conn, session_id)
    return payload


@router.post("/api/practice/sessions/{session_id}/finish")
def finish_practice_session(
    session_id: uuid.UUID,
    user_id: uuid.UUID = Depends(get_current_user_id),
) -> dict:
    """Actively end the practice without a final score.

    Keeps already-submitted units intact; produces no fabricated full-exam
    result (scoring completion is Task 08). Idempotent: finishing an already
    ended_early session returns it unchanged.
    """
    engine = get_engine()
    with engine.begin() as conn:
        owned = _load_owned_session(conn, session_id, user_id)
        if owned is None:
            raise HTTPException(status_code=404, detail="session not found")
        if owned["state"] == "ended_early":
            payload = _session_payload(conn, session_id)
            payload["idempotent"] = True
            return payload
        if owned["state"] != "in_progress":
            raise HTTPException(
                status_code=409,
                detail={"code": "session_not_active",
                        "message": f"session is {owned['state']} and cannot"
                                   " be finished now"})
        conn.execute(text(
            "UPDATE study_sessions SET state = 'ended_early', ended_at = now(),"
            " version = version + 1 WHERE id = :s AND state = 'in_progress'"),
            {"s": session_id})
        payload = _session_payload(conn, session_id)
    payload["idempotent"] = False
    return payload
