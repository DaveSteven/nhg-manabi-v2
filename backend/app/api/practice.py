"""Practice session management and the answer flow (M2 Tasks 04-08).

Session lifecycle (Task 04):

- One active practice session per user, enforced by the DB partial unique
  index `ux_one_active_practice` AND a pre-check that returns the conflicting
  session id so the frontend can ask "continue or end the old one?".
- Session units are pinned to a concrete release_id at creation time, so a
  later publish never changes what an in-progress session refers to.
- Every route resolves the caller via get_current_user_id and scopes reads
  and writes to that identity; a session owned by someone else is 404.

Answer drafts (Task 05): per-question choices in study_answer_drafts with
row_version optimistic locking — a stale expected_row_version is a 409 that
carries the current version, so the client can re-base without losing data.

Unit submission (Task 06): all questions of a unit are judged and written in
ONE transaction. The session-unit row is locked (SELECT ... FOR UPDATE)
before judging, so a concurrent duplicate submit serializes behind the first
and returns the same stored outcome; the (session_unit_id, question_id) PK
makes duplicate answer rows impossible. Unanswered questions are stored as
chosen_option_id IS NULL / is_correct IS NULL — skip never equals wrong.

Feedback boundary (Task 07): correct answers, correctness and explanations
exist ONLY in the feedback payload, which the backend serves exclusively
when the mode permits it — immediate mode after THAT unit is submitted, end
mode only after the session has formally ended. No other payload ever
contains them; hiding fields in React is never the mechanism.

Results (Task 08): finishing a session where every unit was submitted marks
it completed and writes study_results in the same transaction; ending with
unsubmitted units marks it ended_early and deliberately produces NO result
row — no fabricated full-exam scores.
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
    # exam_id comes from the unit's own (possibly superseded) release, so a
    # session pinned to an old release still knows which exam it belongs to
    units = conn.execute(text(
        "SELECT su.id, su.release_id, su.unit_id, su.position, su.state,"
        " su.submitted_at, r.exam_id"
        " FROM study_session_units su"
        " JOIN exam_releases r ON r.id = su.release_id"
        " WHERE su.session_id = :s ORDER BY su.position"),
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
            "exam_id": u["exam_id"], "state": u["state"],
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


def _load_session_unit(conn, session_id: uuid.UUID,
                       session_unit_id: uuid.UUID,
                       user_id: uuid.UUID) -> dict | None:
    """Session unit owned by user_id (via its session), with session header.

    None when the unit doesn't exist, belongs to another session, or the
    session belongs to someone else — all 404, never a leak.
    """
    return conn.execute(text(
        "SELECT su.id, su.release_id, su.unit_id, su.position, su.state,"
        " su.submitted_at, s.state AS session_state, s.feedback_mode, s.mode"
        " FROM study_session_units su"
        " JOIN study_sessions s ON s.id = su.session_id"
        " WHERE su.session_id = :s AND su.id = :u AND s.user_id = :user"),
        {"s": session_id, "u": session_unit_id,
         "user": user_id}).mappings().first()


def _require_active_practice(unit: dict) -> None:
    if unit["mode"] != "practice":
        raise HTTPException(
            status_code=409,
            detail={"code": "not_a_practice_session",
                    "message": "mock sessions are not supported yet"})
    if unit["session_state"] != "in_progress":
        raise HTTPException(
            status_code=409,
            detail={"code": "session_not_active",
                    "message": "session is no longer in progress"})


# ---------------------------------------------------------------- drafts ----

class DraftSave(BaseModel):
    question_id: str
    chosen_option_id: str | None = None
    expected_row_version: int  # 0 = no draft saved yet


def _conflict(current_version: int) -> HTTPException:
    return HTTPException(
        status_code=409,
        detail={"code": "draft_version_conflict",
                "message": "draft was changed by another request; "
                           "re-fetch and re-apply",
                "current_row_version": current_version})


@router.put("/api/practice/sessions/{session_id}/units/{session_unit_id}/drafts")
def save_answer_draft(
    session_id: uuid.UUID,
    session_unit_id: uuid.UUID,
    body: DraftSave,
    user_id: uuid.UUID = Depends(get_current_user_id),
) -> dict:
    """Save (or modify / clear) one question's draft choice.

    Optimistic locking via row_version: expected_row_version must match the
    stored version (0 when no draft exists yet). A stale request gets 409
    with the current version — old requests can never overwrite newer data.
    A draft is NOT a submission; submitted units are locked.
    """
    engine = get_engine()
    with engine.begin() as conn:
        unit = _load_session_unit(conn, session_id, session_unit_id, user_id)
        if unit is None:
            raise HTTPException(status_code=404, detail="session unit not found")
        _require_active_practice(unit)
        if unit["state"] != "pending":
            raise HTTPException(
                status_code=409,
                detail={"code": "unit_locked",
                        "message": "unit already submitted; drafts are frozen"})

        in_unit = conn.execute(text(
            "SELECT 1 FROM release_questions"
            " WHERE release_id = :r AND unit_id = :uid AND question_id = :q"),
            {"r": unit["release_id"], "uid": unit["unit_id"],
             "q": body.question_id}).scalar()
        if in_unit is None:
            raise HTTPException(
                status_code=422,
                detail={"code": "question_not_in_unit",
                        "message": "question does not belong to this unit",
                        "question_id": body.question_id})
        if body.chosen_option_id is not None:
            valid_option = conn.execute(text(
                "SELECT 1 FROM release_options"
                " WHERE release_id = :r AND question_id = :q"
                " AND option_id = :o"),
                {"r": unit["release_id"], "q": body.question_id,
                 "o": body.chosen_option_id}).scalar()
            if valid_option is None:
                raise HTTPException(
                    status_code=422,
                    detail={"code": "invalid_option",
                            "message": "option does not belong to question",
                            "question_id": body.question_id,
                            "option_id": body.chosen_option_id})

        row = conn.execute(text(
            "SELECT row_version FROM study_answer_drafts"
            " WHERE session_unit_id = :u AND question_id = :q FOR UPDATE"),
            {"u": session_unit_id, "q": body.question_id}).scalar()
        if row is None:
            if body.expected_row_version != 0:
                raise _conflict(0)
            conn.execute(text(
                "INSERT INTO study_answer_drafts (session_unit_id, release_id,"
                " unit_id, question_id, chosen_option_id, row_version,"
                " updated_at)"
                " VALUES (:u, :r, :uid, :q, :c, 1, now())"),
                {"u": session_unit_id, "r": unit["release_id"],
                 "uid": unit["unit_id"], "q": body.question_id,
                 "c": body.chosen_option_id})
            new_version = 1
        else:
            if row != body.expected_row_version:
                raise _conflict(row)
            conn.execute(text(
                "UPDATE study_answer_drafts SET chosen_option_id = :c,"
                " row_version = row_version + 1, updated_at = now()"
                " WHERE session_unit_id = :u AND question_id = :q"),
                {"c": body.chosen_option_id, "u": session_unit_id,
                 "q": body.question_id})
            new_version = row + 1
    return {"session_unit_id": str(session_unit_id),
            "question_id": body.question_id,
            "chosen_option_id": body.chosen_option_id,
            "row_version": new_version}


@router.get("/api/practice/sessions/{session_id}/drafts")
def list_answer_drafts(
    session_id: uuid.UUID,
    user_id: uuid.UUID = Depends(get_current_user_id),
) -> dict:
    """All drafts of the session — the refresh-restore payload.

    Drafts only ever contain the client's own choices; no keys, ever.
    """
    with get_engine().connect() as conn:
        owned = _load_owned_session(conn, session_id, user_id)
        if owned is None:
            raise HTTPException(status_code=404, detail="session not found")
        rows = conn.execute(text(
            "SELECT su.id AS session_unit_id, su.unit_id, su.position,"
            " d.question_id, d.chosen_option_id, d.row_version, d.updated_at"
            " FROM study_answer_drafts d"
            " JOIN study_session_units su ON su.id = d.session_unit_id"
            " WHERE su.session_id = :s"
            " ORDER BY su.position, d.question_id"),
            {"s": session_id}).mappings().all()
    return {"drafts": [{
        "session_unit_id": str(r["session_unit_id"]), "unit_id": r["unit_id"],
        "unit_position": r["position"], "question_id": r["question_id"],
        "chosen_option_id": r["chosen_option_id"],
        "row_version": r["row_version"],
        "updated_at": r["updated_at"].isoformat(),
    } for r in rows]}


# --------------------------------------------------------------- submit ----

class SubmittedAnswer(BaseModel):
    question_id: str
    chosen_option_id: str | None = None  # null = deliberately skipped


class UnitSubmit(BaseModel):
    answers: list[SubmittedAnswer]  # questions absent from the list = skip

    @field_validator("answers")
    @classmethod
    def no_duplicate_questions(cls, v: list[SubmittedAnswer]) -> list[SubmittedAnswer]:
        ids = [a.question_id for a in v]
        if len(ids) != len(set(ids)):
            raise ValueError("duplicate question_id in submit request")
        return v


def _build_unit_feedback(conn, release_id, unit_id: str,
                         session_unit_id) -> dict:
    """Full review payload for a submitted unit: chosen vs correct keys and
    explanations. Served ONLY through the Task 07 permission gate."""
    questions = conn.execute(text(
        "SELECT question_id, position, printed_number FROM release_questions"
        " WHERE release_id = :r AND unit_id = :uid ORDER BY position"),
        {"r": release_id, "uid": unit_id}).mappings().all()
    submitted = conn.execute(text(
        "SELECT question_id, chosen_option_id, correct_option_id, is_correct"
        " FROM study_submitted_answers WHERE session_unit_id = :u"),
        {"u": session_unit_id}).mappings().all()
    by_q = {s["question_id"]: s for s in submitted}
    q_explanations: dict[str | None, list] = {}
    exps = conn.execute(text(
        "SELECT question_id, kind, language, content FROM release_explanations"
        " WHERE release_id = :r AND (unit_id = :uid OR question_id IN ("
        "   SELECT question_id FROM release_questions"
        "   WHERE release_id = :r AND unit_id = :uid))"),
        {"r": release_id, "uid": unit_id}).mappings().all()
    for e in exps:
        q_explanations.setdefault(e["question_id"], []).append(
            {"kind": e["kind"], "language": e["language"],
             "content": e["content"]})
    entries = []
    for q in questions:
        s = by_q.get(q["question_id"])
        entries.append({
            "question_id": q["question_id"], "position": q["position"],
            "printed_number": q["printed_number"],
            "chosen_option_id": s["chosen_option_id"] if s else None,
            "correct_option_id": s["correct_option_id"] if s else None,
            "is_correct": s["is_correct"] if s else None,
            "skipped": bool(s is None or s["chosen_option_id"] is None),
            "explanations": q_explanations.get(q["question_id"], []),
        })
    return {
        "unit_id": unit_id, "release_id": str(release_id),
        "questions": entries,
        "unit_explanations": q_explanations.get(None, []),
    }


@router.post("/api/practice/sessions/{session_id}/units/{session_unit_id}/submit")
def submit_session_unit(
    session_id: uuid.UUID,
    session_unit_id: uuid.UUID,
    body: UnitSubmit,
    user_id: uuid.UUID = Depends(get_current_user_id),
) -> dict:
    """Formally submit a whole unit; server-side judging, one transaction.

    Atomicity: judging all questions + writing study_submitted_answers +
    flipping the session unit to 'submitted' happen in a single transaction
    guarded by a row lock on the session unit — a multi-question group (e.g.
    a 5-slot grammar cloze) either lands completely or not at all, and a
    duplicate/concurrent submit returns the stored outcome unchanged
    (idempotent=true) instead of writing a second set of answers.

    Unanswered questions are recorded with chosen_option_id IS NULL and
    is_correct IS NULL (skip != wrong). In 'end' feedback mode the response
    carries NO correctness information.
    """
    engine = get_engine()
    with engine.begin() as conn:
        unit = _load_session_unit(conn, session_id, session_unit_id, user_id)
        if unit is None:
            raise HTTPException(status_code=404, detail="session unit not found")
        _require_active_practice(unit)

        # Lock the session row FIRST (same order as finish), so a submit
        # racing a finish serializes instead of interleaving: finish sees
        # this unit either fully submitted or still pending, never half-way.
        session_locked = conn.execute(text(
            "SELECT state, mode FROM study_sessions"
            " WHERE id = :s AND user_id = :user FOR UPDATE"),
            {"s": session_id, "user": user_id}).mappings().first()
        if session_locked["mode"] != "practice":
            raise HTTPException(
                status_code=409,
                detail={"code": "not_a_practice_session",
                        "message": "mock sessions are not supported yet"})
        if session_locked["state"] != "in_progress":
            raise HTTPException(
                status_code=409,
                detail={"code": "session_not_active",
                        "message": "session is no longer in progress"})

        # Serialize concurrent submits of the same unit.
        locked_state = conn.execute(text(
            "SELECT state FROM study_session_units WHERE id = :u FOR UPDATE"),
            {"u": session_unit_id}).scalar()
        already = locked_state == "submitted"

        if not already:
            answer_map = {a.question_id: a.chosen_option_id
                          for a in body.answers}
            questions = conn.execute(text(
                "SELECT question_id FROM release_questions"
                " WHERE release_id = :r AND unit_id = :uid ORDER BY position"),
                {"r": unit["release_id"], "uid": unit["unit_id"]}).scalars().all()
            if not questions:
                raise HTTPException(
                    status_code=422,
                    detail={"code": "unit_has_no_questions",
                            "message": "unit has no judgeable questions"})
            for qid in answer_map:
                if qid not in set(questions):
                    raise HTTPException(
                        status_code=422,
                        detail={"code": "question_not_in_unit",
                                "message": "question does not belong to unit",
                                "question_id": qid})

            judged = []
            for qid in questions:
                chosen = answer_map.get(qid)
                if chosen is not None:
                    valid = conn.execute(text(
                        "SELECT 1 FROM release_options WHERE release_id = :r"
                        " AND question_id = :q AND option_id = :o"),
                        {"r": unit["release_id"], "q": qid,
                         "o": chosen}).scalar()
                    if valid is None:
                        raise HTTPException(
                            status_code=422,
                            detail={"code": "invalid_option",
                                    "message": "option does not belong to"
                                               " question",
                                    "question_id": qid,
                                    "option_id": chosen})
                key = conn.execute(text(
                    "SELECT correct_option_id, revision FROM"
                    " release_answer_keys WHERE release_id = :r"
                    " AND question_id = :q"),
                    {"r": unit["release_id"], "q": qid}).mappings().first()
                if key is None:
                    raise HTTPException(
                        status_code=422,
                        detail={"code": "answer_key_missing",
                                "message": "no answer key for question; "
                                           "cannot judge",
                                "question_id": qid})
                judged.append((qid, chosen, key["correct_option_id"],
                               key["revision"]))

            for qid, chosen, correct_id, rev in judged:
                is_correct = None if chosen is None else chosen == correct_id
                conn.execute(text(
                    "INSERT INTO study_submitted_answers (session_unit_id,"
                    " release_id, unit_id, question_id, chosen_option_id,"
                    " correct_option_id, answer_key_revision, is_correct)"
                    " VALUES (:u, :r, :uid, :q, :c, :cc, :rev, :ok)"),
                    {"u": session_unit_id, "r": unit["release_id"],
                     "uid": unit["unit_id"], "q": qid, "c": chosen,
                     "cc": correct_id, "rev": rev, "ok": is_correct})
            conn.execute(text(
                "UPDATE study_session_units SET state = 'submitted',"
                " submitted_at = now() WHERE id = :u AND state = 'pending'"),
                {"u": session_unit_id})

        answered = conn.execute(text(
            "SELECT count(*) FILTER (WHERE chosen_option_id IS NOT NULL),"
            " count(*) FROM study_submitted_answers"
            " WHERE session_unit_id = :u"),
            {"u": session_unit_id}).first()
        payload = {
            "session_unit_id": str(session_unit_id),
            "unit_id": unit["unit_id"], "release_id": str(unit["release_id"]),
            "state": "submitted",
            "answered_count": answered[0], "skipped_count": answered[1] - answered[0],
            "idempotent": already,
        }
        # Task 07 boundary: immediate mode may reveal THIS unit now; end
        # mode reveals nothing until the session formally ends.
        if unit["feedback_mode"] == "immediate":
            payload["feedback"] = _build_unit_feedback(
                conn, unit["release_id"], unit["unit_id"], session_unit_id)
            # Same shape as GET /feedback (which also carries the mode).
            payload["feedback"]["feedback_mode"] = unit["feedback_mode"]
    return payload


# -------------------------------------------------------------- feedback ----

def _feedback_gate(unit: dict) -> None:
    """Shared reveal gate for unit feedback AND listening transcripts.

    immediate mode: allowed once THAT unit is submitted. end mode: allowed
    only after the session formally ends (completed / ended_early). Units
    never submitted get nothing — answers, explanations and cues stay
    sealed. This gate is the mechanism; the frontend merely renders what
    it receives (audio-player.md §8).
    """
    if unit["state"] != "submitted":
        raise HTTPException(
            status_code=409,
            detail={"code": "unit_not_submitted",
                    "message": "content is only revealed for formally"
                               " submitted units"})
    if (unit["feedback_mode"] == "end"
            and unit["session_state"] == "in_progress"):
        raise HTTPException(
            status_code=409,
            detail={"code": "feedback_locked_until_end",
                    "message": "unified feedback is revealed only after"
                               " the session ends"})


@router.get("/api/practice/sessions/{session_id}/units/{session_unit_id}/feedback")
def get_unit_feedback(
    session_id: uuid.UUID,
    session_unit_id: uuid.UUID,
    user_id: uuid.UUID = Depends(get_current_user_id),
) -> dict:
    """Correct answers + explanations for ONE unit, permission-gated."""
    with get_engine().connect() as conn:
        unit = _load_session_unit(conn, session_id, session_unit_id, user_id)
        if unit is None:
            raise HTTPException(status_code=404, detail="session unit not found")
        _feedback_gate(unit)
        payload = _build_unit_feedback(conn, unit["release_id"],
                                       unit["unit_id"], session_unit_id)
    payload["feedback_mode"] = unit["feedback_mode"]
    return payload


# ------------------------------------------------------------- transcript ----

@router.get("/api/practice/sessions/{session_id}/units/{session_unit_id}/transcript")
def get_unit_transcript(
    session_id: uuid.UUID,
    session_unit_id: uuid.UUID,
    user_id: uuid.UUID = Depends(get_current_user_id),
) -> dict:
    """Listening transcript cues for ONE unit, permission-gated.

    Transcript text can directly contain answer clues, so it uses the SAME
    reveal gate as feedback (audio-player.md §8): immediate mode after that
    unit is submitted, end mode only after the session formally ends. cues
    never appear in any other student payload (content.py strips them from
    every public unit response); the only path to them runs through this
    gate. Units with no cue-bearing materials return an empty list.
    """
    with get_engine().connect() as conn:
        unit = _load_session_unit(conn, session_id, session_unit_id, user_id)
        if unit is None:
            raise HTTPException(status_code=404, detail="session unit not found")
        _feedback_gate(unit)
        materials = conn.execute(text(
            "SELECT material_id, kind, language, cues"
            " FROM release_unit_materials"
            " WHERE release_id = :r AND unit_id = :u"
            "   AND cues IS NOT NULL ORDER BY position"),
            {"r": unit["release_id"], "u": unit["unit_id"]}).mappings().all()
    return {
        "session_unit_id": str(session_unit_id),
        "unit_id": unit["unit_id"],
        "release_id": str(unit["release_id"]),
        "feedback_mode": unit["feedback_mode"],
        "materials": [{
            "material_id": m["material_id"], "kind": m["kind"],
            "language": m["language"], "cues": m["cues"],
        } for m in materials],
    }


# --------------------------------------------------------------- results ----

def _build_results(conn, session_id: uuid.UUID) -> dict:
    """Full session result: aggregate counts + per-question review data."""
    row = conn.execute(text(
        "SELECT r.correct_count, r.wrong_count, r.skipped_count,"
        " r.total_count, r.scoring_method, r.scoring_version, r.finished_at"
        " FROM study_results r WHERE r.session_id = :s"),
        {"s": session_id}).mappings().first()
    if row is None:
        return {}
    total = row["total_count"]
    answered = row["correct_count"] + row["wrong_count"]
    detail = conn.execute(text(
        "SELECT su.unit_id, su.position AS unit_position,"
        " sa.question_id, rq.position AS question_position,"
        " rq.printed_number, sa.chosen_option_id, sa.correct_option_id,"
        " sa.is_correct"
        " FROM study_session_units su"
        " JOIN study_submitted_answers sa ON sa.session_unit_id = su.id"
        " JOIN release_questions rq ON rq.release_id = sa.release_id"
        "  AND rq.unit_id = sa.unit_id AND rq.question_id = sa.question_id"
        " WHERE su.session_id = :s"
        " ORDER BY su.position, rq.position"),
        {"s": session_id}).mappings().all()
    return {
        "correct_count": row["correct_count"],
        "wrong_count": row["wrong_count"],
        "skipped_count": row["skipped_count"],
        "total_count": total,
        "score_rate": round(row["correct_count"] / total, 4) if total else 0.0,
        "answered_accuracy": (round(row["correct_count"] / answered, 4)
                              if answered else None),
        "scoring_method": row["scoring_method"],
        "scoring_version": row["scoring_version"],
        "finished_at": row["finished_at"].isoformat(),
        "questions": [{
            "unit_id": d["unit_id"], "unit_position": d["unit_position"],
            "question_id": d["question_id"],
            "question_position": d["question_position"],
            "printed_number": d["printed_number"],
            "chosen_option_id": d["chosen_option_id"],
            "correct_option_id": d["correct_option_id"],
            "is_correct": d["is_correct"],
            "skipped": d["chosen_option_id"] is None,
        } for d in detail],
    }


@router.post("/api/practice/sessions/{session_id}/finish")
def finish_practice_session(
    session_id: uuid.UUID,
    user_id: uuid.UUID = Depends(get_current_user_id),
) -> dict:
    """Formally end the practice session.

    All units submitted -> state='completed' and study_results written in
    the same transaction (correct + wrong + skipped = total, DB CHECKed).
    Any unit still pending -> state='ended_early': already-submitted units
    are kept, but NO result row is written — an early end never produces a
    fabricated full-exam score. Both outcomes are idempotent.
    """
    engine = get_engine()
    with engine.begin() as conn:
        owned = conn.execute(text(
            "SELECT id, state, version FROM study_sessions"
            " WHERE id = :s AND user_id = :u FOR UPDATE"),
            {"s": session_id, "u": user_id}).mappings().first()
        if owned is None:
            raise HTTPException(status_code=404, detail="session not found")
        if owned["state"] == "completed":
            payload = _session_payload(conn, session_id)
            payload["results"] = _build_results(conn, session_id)
            payload["idempotent"] = True
            return payload
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

        units_total, units_submitted = conn.execute(text(
            "SELECT count(*), count(*) FILTER (WHERE state = 'submitted')"
            " FROM study_session_units WHERE session_id = :s"),
            {"s": session_id}).first()
        all_submitted = units_total > 0 and units_total == units_submitted

        if all_submitted:
            correct, wrong, skipped, total = conn.execute(text(
                "SELECT count(*) FILTER (WHERE is_correct IS TRUE),"
                " count(*) FILTER (WHERE is_correct IS FALSE),"
                " count(*) FILTER (WHERE is_correct IS NULL),"
                " count(*)"
                " FROM study_submitted_answers sa"
                " JOIN study_session_units su ON su.id = sa.session_unit_id"
                " WHERE su.session_id = :s"), {"s": session_id}).first()
            conn.execute(text(
                "INSERT INTO study_results (id, session_id, correct_count,"
                " wrong_count, skipped_count, total_count, scoring_method,"
                " scoring_version)"
                " VALUES (gen_random_uuid(), :s, :c, :w, :sk, :t,"
                " 'all_questions', '1')"),
                {"s": session_id, "c": correct, "w": wrong, "sk": skipped,
                 "t": total})
            conn.execute(text(
                "UPDATE study_sessions SET state = 'completed',"
                " ended_at = now(), version = version + 1"
                " WHERE id = :s AND state = 'in_progress'"), {"s": session_id})
            payload = _session_payload(conn, session_id)
            payload["results"] = _build_results(conn, session_id)
            payload["idempotent"] = False
            return payload

        conn.execute(text(
            "UPDATE study_sessions SET state = 'ended_early', ended_at = now(),"
            " version = version + 1 WHERE id = :s AND state = 'in_progress'"),
            {"s": session_id})
        payload = _session_payload(conn, session_id)
    payload["idempotent"] = False
    return payload


@router.get("/api/practice/sessions/{session_id}/results")
def get_session_results(
    session_id: uuid.UUID,
    user_id: uuid.UUID = Depends(get_current_user_id),
) -> dict:
    """The stored result of a completed session (owner only).

    ended_early sessions deliberately have no aggregate result — the
    endpoint says so instead of inventing a score. Per-question review of
    submitted units remains available via the feedback endpoint.
    """
    with get_engine().connect() as conn:
        owned = _load_owned_session(conn, session_id, user_id)
        if owned is None:
            raise HTTPException(status_code=404, detail="session not found")
        if owned["state"] == "ended_early":
            raise HTTPException(
                status_code=409,
                detail={"code": "no_results_early_end",
                        "message": "session ended early; no full result"
                                   " was produced"})
        if owned["state"] != "completed":
            raise HTTPException(
                status_code=409,
                detail={"code": "session_not_finished",
                        "message": "session is still in progress"})
        payload = _build_results(conn, session_id)
    payload["session_id"] = str(session_id)
    return payload
