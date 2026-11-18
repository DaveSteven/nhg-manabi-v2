"""Practice session management and the answer flow (M2 Tasks 04-08).

Session lifecycle (Task 04):

- One recoverable practice session per user (ADR-0016, DB partial unique
  index `ux_one_active_practice`). Starting a new one ABANDONS the previous
  in-progress session inside the same transaction — no conflict, no prompt;
  a failed creation rolls the abandonment back, so the old practice is
  never lost. Submitted answers and results of an abandoned session are
  kept; its unsubmitted drafts never count.
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
from app.question_progress import refresh_question_progress

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
    """Practice-mode session header owned by user_id; 404-worthy when
    missing/foreign. Strict-mock sessions are invisible here (they live
    behind /api/mock-exams, whose phase/abandon rules these routes would
    bypass) — a mock id answers exactly like an unknown id."""
    return conn.execute(text(
        "SELECT id, state, version FROM study_sessions"
        " WHERE id = :s AND user_id = :u"
        " AND mode IN ('practice', 'quick_practice')"),
        {"s": session_id, "u": user_id}).mappings().first()


@router.post("/api/practice/sessions", status_code=201)
def create_practice_session(
    body: PracticeSessionCreate,
    user_id: uuid.UUID = Depends(get_current_user_id),
) -> dict:
    return _create_session_tx(get_engine(), body, user_id)


def _create_session_tx(engine, body: PracticeSessionCreate,
                       user_id: uuid.UUID,
                       config_extra: dict | None = None) -> dict:
    """Abandon the user's in-progress practice (if any) and create the new
    one atomically. Two simultaneous starts race on ux_one_active_practice:
    the loser re-runs once (it then abandons the winner — latest wins);
    only a second consecutive collision surfaces as 409."""
    for attempt in (1, 2):
        try:
            return _replace_and_create(engine, body, user_id, config_extra)
        except IntegrityError:
            if attempt == 2:
                raise HTTPException(
                    status_code=409,
                    detail={"code": "session_replace_conflict",
                            "message": "concurrent practice start; retry"})
    raise AssertionError("unreachable")


def _replace_and_create(engine, body: PracticeSessionCreate,
                        user_id: uuid.UUID,
                        config_extra: dict | None) -> dict:
    with engine.begin() as conn:
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

        # Validation above passed: only now retire the previous practice.
        # Same transaction as the INSERT below, so any failure (here or
        # later) rolls the abandonment back and the old session survives.
        conn.execute(text(
            "UPDATE study_sessions SET state = 'abandoned', ended_at = now(),"
            " version = version + 1"
            " WHERE user_id = :u AND mode = 'practice'"
            "   AND state = 'in_progress'"), {"u": user_id})

        session_id = conn.execute(text(
            "INSERT INTO study_sessions (id, user_id, mode, feedback_mode,"
            " state, mock_release_id, config)"
            " VALUES (gen_random_uuid(), :u, 'practice', :f,"
            " 'in_progress', NULL, CAST(:cfg AS jsonb)) RETURNING id"),
            {"u": user_id, "f": body.feedback_mode,
             "cfg": json.dumps({
                 **(config_extra or {}),
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


# ----------------------------------------------------- quick practice ----

class QuickPracticeCreate(BaseModel):
    release_id: uuid.UUID
    unit_id: str


@router.post("/api/quick-practice/sessions", status_code=201)
def create_quick_practice_session(
    body: QuickPracticeCreate,
    user_id: uuid.UUID = Depends(get_current_user_id),
) -> dict:
    """Quick Practice (quick-practice.md v2.0): click a unit, practice now.

    - Own mode `quick_practice`, so it never interacts with the 专项
      session slot (ADR-0016); only a concurrent quick double-click can
      409 at ux_one_active_quick.
    - A stale in-progress QUICK session (user left without submitting) is
      ended silently (ended_early, same transaction) — unsubmitted quick
      selections reset by design, so there is nothing to resume and no
      "continue old practice?" dialog. Only in-progress QUICK sessions are
      touched; 专项/模考 sessions are never altered here.
    - feedback_mode is fixed to immediate.
    """
    engine = get_engine()
    try:
        with engine.begin() as conn:
            # Silent replace WITHIN the quick mode only. A concurrent
            # double-click still loses at ux_one_active_quick → 409; the
            # client may simply retry (the winner is a fresh session too).
            conn.execute(text(
                "UPDATE study_sessions SET state = 'ended_early',"
                " ended_at = now(), version = version + 1"
                " WHERE user_id = :u AND mode = 'quick_practice'"
                "   AND state = 'in_progress'"), {"u": user_id})

            # Same availability gate as practice sessions: the unit must be
            # in the CURRENT published release and conversion-complete.
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
                {"r": body.release_id, "uid": body.unit_id}).mappings().first()
            if meta is None:
                raise HTTPException(
                    status_code=422,
                    detail={"code": "unit_not_available",
                            "message": "unit is not available for practice",
                            "release_id": str(body.release_id),
                            "unit_id": body.unit_id})

            session_id = conn.execute(text(
                "INSERT INTO study_sessions (id, user_id, mode,"
                " feedback_mode, state, mock_release_id, config)"
                " VALUES (gen_random_uuid(), :u, 'quick_practice',"
                " 'immediate', 'in_progress', NULL, CAST(:cfg AS jsonb))"
                " RETURNING id"),
                {"u": user_id,
                 "cfg": json.dumps({"requested_units": [
                     {"release_id": str(body.release_id),
                      "unit_id": body.unit_id}]})}).scalar()
            conn.execute(text(
                "INSERT INTO study_session_units (id, session_id,"
                " release_id, unit_id, position, state)"
                " VALUES (gen_random_uuid(), :s, :r, :uid, 1, 'pending')"),
                {"s": session_id, "r": meta["release_id"],
                 "uid": meta["unit_id"]})
            payload = _session_payload(conn, session_id)
            payload["units_meta"] = [{
                "release_id": str(meta["release_id"]),
                "unit_id": meta["unit_id"], "layer_id": meta["layer_id"],
                "question_type_id": meta["question_type_id"],
                "exam_id": meta["exam_id"],
                "question_count": meta["question_count"],
            }]
    except IntegrityError:
        raise HTTPException(
            status_code=409,
            detail={"code": "active_session_exists",
                    "message": "an active quick practice session already"
                               " exists"})
    return payload


@router.get("/api/practice/sessions/current")
def get_current_practice_session(
    user_id: uuid.UUID = Depends(get_current_user_id),
) -> dict:
    """The caller's single recoverable practice session (at most one
    in-progress `practice` session exists, ADR-0016) — 首页「继续上次练习」."""
    with get_engine().connect() as conn:
        session_id = conn.execute(text(
            "SELECT id FROM study_sessions"
            " WHERE user_id = :u AND mode = 'practice'"
            " AND state = 'in_progress'"
            " ORDER BY created_at DESC, id DESC LIMIT 1"),
            {"u": user_id}).scalar()
        if session_id is None:
            raise HTTPException(status_code=404, detail="no active practice")
        payload = _session_payload(conn, session_id)
    return payload


@router.get("/api/exams/{exam_id}/practice-status")
def get_exam_practice_status(
    exam_id: str,
    user_id: uuid.UUID = Depends(get_current_user_id),
) -> dict:
    """Per-unit practice history of the CALLER for one exam (Quick Practice
    unit rows): units with any formally submitted session unit in ANY
    release of this exam, counting BOTH practice modes (专项 sessions and
    quick sessions are equally real formal practice). One submitted
    session unit = one practice of that unit regardless of how many
    questions it holds; idempotent duplicate submits reuse the same row,
    so they never inflate the count. Own data only; never exposes answers."""
    with get_engine().connect() as conn:
        rows = conn.execute(text(
            "SELECT su.unit_id, count(*) AS submitted_count,"
            " max(su.submitted_at) AS last_submitted_at"
            " FROM study_session_units su"
            " JOIN study_sessions s ON s.id = su.session_id"
            " JOIN exam_releases er ON er.id = su.release_id"
            " WHERE s.user_id = :u"
            "   AND s.mode IN ('practice', 'quick_practice')"
            "   AND su.state = 'submitted' AND er.exam_id = :e"
            " GROUP BY su.unit_id"),
            {"u": user_id, "e": exam_id}).mappings().all()
    return {"exam_id": exam_id, "units": [{
        "unit_id": r["unit_id"],
        "submitted_count": r["submitted_count"],
        "last_submitted_at": (r["last_submitted_at"].isoformat()
                              if r["last_submitted_at"] else None),
    } for r in rows]}


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
        " WHERE su.session_id = :s AND su.id = :u AND s.user_id = :user"
        " AND s.mode IN ('practice', 'quick_practice')"),
        {"s": session_id, "u": session_unit_id,
         "user": user_id}).mappings().first()


def _require_active_practice(unit: dict) -> None:
    """Accept both practice modes (专项 and Quick Practice); mock stays
    unsupported. Quick sessions share the submit/draft/feedback machinery
    but live in their own mode, so they never conflict with 专项 practice
    (quick-practice.md v2.0 §3)."""
    if unit["mode"] not in ("practice", "quick_practice"):
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
        return _save_draft(conn, unit, session_unit_id, body)


def _save_draft(conn, unit: dict, session_unit_id: uuid.UUID,
                body: DraftSave) -> dict:
    """Shared draft write (practice + strict mock): validation, optimistic
    row_version locking, insert/update — inside the caller's transaction."""
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


def _judge_and_store_unit(conn, release_id, unit_id: str, session_unit_id,
                          answer_map: dict, user_id: uuid.UUID,
                          refresh_progress: bool = True) -> None:
    """Judge every question of one unit and write the formal answers, then
    flip the session unit to 'submitted' — all in the CALLER's transaction.
    Raises HTTPException (422) before writing anything for this unit when
    an answer is invalid, so the caller's transaction rolls back whole.
    Questions absent from answer_map are skips (chosen NULL, is_correct NULL).
    """
    questions = conn.execute(text(
        "SELECT question_id FROM release_questions"
        " WHERE release_id = :r AND unit_id = :uid ORDER BY position"),
        {"r": release_id, "uid": unit_id}).scalars().all()
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
                {"r": release_id, "q": qid, "o": chosen}).scalar()
            if valid is None:
                raise HTTPException(
                    status_code=422,
                    detail={"code": "invalid_option",
                            "message": "option does not belong to question",
                            "question_id": qid, "option_id": chosen})
        key = conn.execute(text(
            "SELECT correct_option_id, revision FROM release_answer_keys"
            " WHERE release_id = :r AND question_id = :q"),
            {"r": release_id, "q": qid}).mappings().first()
        if key is None:
            raise HTTPException(
                status_code=422,
                detail={"code": "answer_key_missing",
                        "message": "no answer key for question; cannot judge",
                        "question_id": qid})
        judged.append((qid, chosen, key["correct_option_id"], key["revision"]))

    for qid, chosen, correct_id, rev in judged:
        is_correct = None if chosen is None else chosen == correct_id
        conn.execute(text(
            "INSERT INTO study_submitted_answers (session_unit_id,"
            " release_id, unit_id, question_id, chosen_option_id,"
            " correct_option_id, answer_key_revision, is_correct)"
            " VALUES (:u, :r, :uid, :q, :c, :cc, :rev, :ok)"),
            {"u": session_unit_id, "r": release_id, "uid": unit_id,
             "q": qid, "c": chosen, "cc": correct_id, "rev": rev,
             "ok": is_correct})
    conn.execute(text(
        "UPDATE study_session_units SET state = 'submitted',"
        " submitted_at = now() WHERE id = :u AND state = 'pending'"),
        {"u": session_unit_id})
    # Same transaction: the derived per-question cache never lags the
    # formal answers (and rolls back with them). Strict mock answers are kept
    # out of practice statistics (ADR-0019 M7), so they skip the cache.
    if refresh_progress:
        refresh_question_progress(conn, user_id, list(questions))


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
        if unit["mode"] == "practice" and unit["feedback_mode"] == "end":
            # 统一反馈: nothing may be formally written unit by unit — the
            # whole session is judged by POST /sessions/{id}/submit.
            raise HTTPException(
                status_code=409,
                detail={"code": "end_mode_requires_final_submit",
                        "message": "unified-feedback sessions are submitted"
                                   " once, as a whole"})

        # Lock the session row FIRST (same order as finish), so a submit
        # racing a finish serializes instead of interleaving: finish sees
        # this unit either fully submitted or still pending, never half-way.
        session_locked = conn.execute(text(
            "SELECT state, mode FROM study_sessions"
            " WHERE id = :s AND user_id = :user FOR UPDATE"),
            {"s": session_id, "user": user_id}).mappings().first()
        if session_locked["mode"] not in ("practice", "quick_practice"):
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
            _judge_and_store_unit(
                conn, unit["release_id"], unit["unit_id"], session_unit_id,
                {a.question_id: a.chosen_option_id for a in body.answers},
                user_id)

        # Quick Practice never lingers as an open session: submitting its
        # single unit IS finishing the session — the aggregate result row
        # and the completed state land in the SAME transaction, so a crash
        # between them is impossible (quick-practice.md v2.0 §3.4). A
        # duplicate submit (already=True) is fully idempotent and does not
        # re-complete or re-judge anything.
        quick_completed = False
        if not already and session_locked["mode"] == "quick_practice":
            _complete_session(conn, session_id)
            quick_completed = True

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
            # Post-submit session state (quick sessions complete on submit).
            "session_state": "completed" if quick_completed
            else session_locked["state"],
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
        body = _build_unit_transcript(conn, unit["release_id"], unit["unit_id"])
    return {
        "session_unit_id": str(session_unit_id),
        "unit_id": unit["unit_id"],
        "release_id": str(unit["release_id"]),
        "feedback_mode": unit["feedback_mode"],
        **body,
    }


def _build_unit_transcript(conn, release_id, unit_id: str) -> dict:
    """Transcript cues (+ paired zh translation) of one unit. Callers MUST
    have passed their own reveal gate (practice `_feedback_gate`, or the
    completed-mock check)."""
    materials = conn.execute(text(
        "SELECT material_id, kind, language, cues,"
        " translated_from_material_id"
        " FROM release_unit_materials"
        " WHERE release_id = :r AND unit_id = :u"
        "   AND cues IS NOT NULL ORDER BY position"),
        {"r": release_id, "u": unit_id}).mappings().all()
    # Chinese companion text (converter stores the raw group
    # `translation` as a unit-level zh-CN explanation). Its paragraph
    # blocks align with the transcript cues by order; paired 1:1 ONLY
    # when the counts match — never guessed or padded.
    translation = None
    zh = conn.execute(text(
        "SELECT content FROM release_explanations"
        " WHERE release_id = :r AND unit_id = :u"
        "   AND kind = 'translation' AND language = 'zh-CN'"
        " ORDER BY revision DESC, explanation_id DESC LIMIT 1"),
        {"r": release_id, "u": unit_id}).scalar()
    if materials and zh and isinstance(zh, dict):
        blocks = zh.get("blocks") or []
        first_cues = materials[0]["cues"] or []
        if len(blocks) == len(first_cues):
            translation = {
                "language": "zh-CN",
                "cues": [{"index": cue["index"],
                          "children": block.get("children")}
                         for cue, block in zip(first_cues, blocks)],
            }
    return {
        "materials": [{
            "material_id": m["material_id"], "kind": m["kind"],
            "language": m["language"], "cues": m["cues"],
            # pairing field for translated transcripts (canonical-schema:
            # transcript and its translation are separate materials)
            "translated_from_material_id": m["translated_from_material_id"],
        } for m in materials],
        "translation": translation,
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


def _complete_session(conn, session_id: uuid.UUID,
                      scoring_method: str = "all_questions") -> None:
    """Mark the session completed + write its aggregate result row in the
    CALLER's transaction (correct + wrong + skipped = total, DB CHECKed).
    Shared by the finish endpoint and Quick Practice submit auto-complete.
    """
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
        " :m, '1')"),
        {"s": session_id, "c": correct, "w": wrong, "sk": skipped,
         "t": total, "m": scoring_method})
    conn.execute(text(
        "UPDATE study_sessions SET state = 'completed',"
        " ended_at = now(), version = version + 1"
        " WHERE id = :s AND state = 'in_progress'"), {"s": session_id})


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
            " WHERE id = :s AND user_id = :u"
            " AND mode IN ('practice', 'quick_practice') FOR UPDATE"),
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
            _complete_session(conn, session_id)
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


class FinalAnswer(BaseModel):
    session_unit_id: uuid.UUID
    question_id: str
    chosen_option_id: str | None = None  # null = left unanswered (skip)


class SessionSubmit(BaseModel):
    answers: list[FinalAnswer]  # questions absent from the list = skip

    @field_validator("answers")
    @classmethod
    def no_duplicates(cls, v: list[FinalAnswer]) -> list[FinalAnswer]:
        keys = [(a.session_unit_id, a.question_id) for a in v]
        if len(keys) != len(set(keys)):
            raise ValueError("duplicate answer in submit request")
        return v


@router.post("/api/practice/sessions/{session_id}/submit")
def submit_practice_session(
    session_id: uuid.UUID,
    body: SessionSubmit,
    user_id: uuid.UUID = Depends(get_current_user_id),
) -> dict:
    """统一反馈: formally submit the WHOLE session at once.

    Until this call, a unified-feedback session holds drafts only —
    navigating questions or units never writes a formal answer or judges.
    Here, in ONE transaction under the session row lock: every pending
    unit is judged and its answers written, all units flip to 'submitted',
    and the session completes with its aggregate study_results row. Any
    invalid answer rolls the whole submission back (nothing half-written).
    The request body is the authoritative final answer set (drafts only
    exist for refresh-restore); questions missing from it are skips.

    Idempotent: a session that is already completed returns its stored
    results unchanged and never re-judges or rewrites anything.
    """
    engine = get_engine()
    with engine.begin() as conn:
        owned = conn.execute(text(
            "SELECT id, state, mode, feedback_mode FROM study_sessions"
            " WHERE id = :s AND user_id = :u"
            " AND mode IN ('practice', 'quick_practice') FOR UPDATE"),
            {"s": session_id, "u": user_id}).mappings().first()
        if owned is None:
            raise HTTPException(status_code=404, detail="session not found")
        if owned["mode"] != "practice" or owned["feedback_mode"] != "end":
            raise HTTPException(
                status_code=409,
                detail={"code": "final_submit_end_mode_only",
                        "message": "only unified-feedback practice sessions"
                                   " are submitted as a whole"})
        if owned["state"] == "completed":
            payload = _session_payload(conn, session_id)
            payload["results"] = _build_results(conn, session_id)
            payload["idempotent"] = True
            return payload
        if owned["state"] != "in_progress":
            raise HTTPException(
                status_code=409,
                detail={"code": "session_not_active",
                        "message": f"session is {owned['state']} and cannot"
                                   " be submitted"})

        units = conn.execute(text(
            "SELECT id, release_id, unit_id, state FROM study_session_units"
            " WHERE session_id = :s ORDER BY position FOR UPDATE"),
            {"s": session_id}).mappings().all()
        by_unit: dict[uuid.UUID, dict] = {u["id"]: {} for u in units}
        for a in body.answers:
            if a.session_unit_id not in by_unit:
                raise HTTPException(
                    status_code=422,
                    detail={"code": "session_unit_not_in_session",
                            "message": "answer references a unit outside"
                                       " this session",
                            "session_unit_id": str(a.session_unit_id)})
            by_unit[a.session_unit_id][a.question_id] = a.chosen_option_id
        for u in units:
            if u["state"] == "pending":
                _judge_and_store_unit(conn, u["release_id"], u["unit_id"],
                                      u["id"], by_unit[u["id"]], user_id)
        _complete_session(conn, session_id)
        payload = _session_payload(conn, session_id)
        payload["results"] = _build_results(conn, session_id)
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
        if owned["state"] == "abandoned":
            raise HTTPException(
                status_code=409,
                detail={"code": "session_abandoned",
                        "message": "session was replaced by a newer practice;"
                                   " no result was produced"})
        if owned["state"] != "completed":
            raise HTTPException(
                status_code=409,
                detail={"code": "session_not_finished",
                        "message": "session is still in progress"})
        payload = _build_results(conn, session_id)
    payload["session_id"] = str(session_id)
    return payload
