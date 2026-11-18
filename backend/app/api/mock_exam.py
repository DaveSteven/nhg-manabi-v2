"""Strict mock exam (ADR-0019): server-timed Phases, sealed on expiry.

Rules enforced here (the client only displays):

- Time: every Phase run has a server `expires_at`. There is no background
  worker; any request touching a mock session first runs `_advance`, which
  seals every run whose time is up — in order, each next Phase starting at
  the previous one's expiry (the clock never stops while the user is away).
  Sealing submits the saved DRAFT choices formally; no choice = skip
  (skip != wrong). Closing the page is not ending the exam.
- Order: Phases run strictly in sequence; a closed Phase is never reopened or
  editable, early submission does not carry leftover time forward.
- Slots (ADR-0020): a mock has its OWN single in-progress slot
  (`ux_one_active_mock`) and never interacts with practice or Quick Practice
  — starting either leaves a running mock untouched and vice versa. Starting a
  second mock while one is still running is a 409 `mock_in_progress` naming
  the running one (the client offers to continue); `replace_active=true`
  deliberately abandons it.
- Leakage: nothing here returns correct options, explanations or transcripts
  before the LAST Phase is closed. Unit content comes only for the ACTIVE
  Phase and only through the public (answer-free) payload. After completion
  `results` reveals per-question review.
- Statistics: mock answers are formal records but are NOT fed into the
  practice `user_question_progress` cache (ADR-0019 M7: mock and practice
  results stay separate). Mock sessions are not listed in 练习历史.
- Eligibility (M10): an exam is mockable only when its current published
  release has Phases with a duration and every Unit is conversion-complete.
"""
import json
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.api.content import _load_unit_payload
from app.api.practice import (DraftSave, FinalAnswer, _build_results,
                              _complete_session, _judge_and_store_unit,
                              _save_draft)
from app.auth import get_current_user_id
from app.db.engine import get_engine

router = APIRouter()

SCORING_METHOD = "mock_phases"


# ------------------------------------------------------------ eligibility ----

def _plan(conn, exam_id: str) -> dict:
    """Mock plan of the exam's CURRENT published release, or the reason it
    cannot be mocked. Never raises for 'not mockable' (public availability)."""
    head = conn.execute(text(
        "SELECT r.id AS release_id, e.title, e.level"
        " FROM exam_current_releases c"
        " JOIN exam_releases r ON r.id = c.release_id"
        " JOIN exam_catalogs e ON e.id = c.exam_id"
        " WHERE c.exam_id = :e AND r.state = 'published'"),
        {"e": exam_id}).mappings().first()
    if head is None:
        return {"available": False, "reason": "exam_not_found"}
    rid = head["release_id"]
    phases = conn.execute(text(
        "SELECT p.phase_id, p.position, p.title, p.duration_seconds,"
        " p.playback_policy,"
        " (SELECT count(*) FROM release_phase_units pu"
        "  WHERE pu.release_id = p.release_id AND pu.phase_id = p.phase_id)"
        "   AS unit_count,"
        " (SELECT count(*) FROM release_phase_units pu"
        "  JOIN release_questions q ON q.release_id = pu.release_id"
        "   AND q.unit_id = pu.unit_id"
        "  WHERE pu.release_id = p.release_id AND pu.phase_id = p.phase_id)"
        "   AS question_count"
        " FROM release_exam_phases p WHERE p.release_id = :r"
        " ORDER BY p.position"), {"r": rid}).mappings().all()
    plan = {"exam_id": exam_id, "release_id": str(rid), "title": head["title"],
            "level": head["level"],
            "phases": [{
                "phase_id": p["phase_id"], "position": p["position"],
                "title": p["title"], "duration_seconds": p["duration_seconds"],
                "playback_policy": p["playback_policy"],
                "unit_count": p["unit_count"],
                "question_count": p["question_count"]} for p in phases]}
    reason = None
    if not phases:
        reason = "no_phases"
    elif any(p["duration_seconds"] is None for p in phases):
        reason = "phase_without_duration"
    elif any(p["unit_count"] == 0 for p in phases):
        reason = "empty_phase"
    elif conn.execute(text(
            "SELECT 1 FROM release_units u WHERE u.release_id = :r"
            " AND (u.conversion_status <> 'complete'"
            "  OR NOT EXISTS (SELECT 1 FROM release_phase_units pu"
            "   WHERE pu.release_id = u.release_id AND pu.unit_id = u.unit_id))"
            " LIMIT 1"), {"r": rid}).scalar():
        reason = "units_not_ready"
    plan["available"] = reason is None
    plan["reason"] = reason
    plan["total_seconds"] = (sum(p["duration_seconds"] for p in phases)
                             if reason is None else None)
    return plan


@router.get("/api/exams/{exam_id}/mock")
def get_mock_availability(exam_id: str) -> dict:
    """Public: whether (and how) the exam can be taken as a strict mock.
    Phases only — no content, no answers."""
    with get_engine().connect() as conn:
        plan = _plan(conn, exam_id)
    plan.pop("release_id", None)
    return plan


# ----------------------------------------------------------- state machine ----

def _lock_session(conn, session_id: uuid.UUID, user_id: uuid.UUID) -> dict:
    row = conn.execute(text(
        "SELECT id, state, mock_release_id AS release_id FROM study_sessions"
        " WHERE id = :s AND user_id = :u AND mode = 'mock' FOR UPDATE"),
        {"s": session_id, "u": user_id}).mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail="mock exam not found")
    return dict(row)


def _start_run(conn, session_id, release_id, phase: dict, started_at) -> None:
    conn.execute(text(
        "INSERT INTO study_phase_runs (id, session_id, release_id, phase_id,"
        " started_at, expires_at)"
        " VALUES (gen_random_uuid(), :s, :r, :p, :t,"
        "  CAST(:t AS timestamptz) + make_interval(secs => :d))"),
        {"s": session_id, "r": release_id, "p": phase["phase_id"],
         "t": started_at, "d": phase["duration_seconds"]})


def _next_phase(conn, release_id, position: int) -> dict | None:
    row = conn.execute(text(
        "SELECT phase_id, duration_seconds FROM release_exam_phases"
        " WHERE release_id = :r AND position > :p ORDER BY position LIMIT 1"),
        {"r": release_id, "p": position}).mappings().first()
    return dict(row) if row else None


def _close_phase(conn, sess: dict, user_id: uuid.UUID, run: dict,
                 answers: dict | None, closed_at) -> None:
    """Formally submit every pending Unit of the Phase, close the run and
    start the next Phase (or complete the exam). `answers` = {session_unit_id:
    {question_id: option_id|None}} from an explicit submit; None = seal from
    the saved drafts (expiry)."""
    units = conn.execute(text(
        "SELECT su.id, su.release_id, su.unit_id FROM study_session_units su"
        " JOIN release_phase_units pu ON pu.release_id = su.release_id"
        "  AND pu.unit_id = su.unit_id AND pu.phase_id = :p"
        " WHERE su.session_id = :s AND su.state = 'pending'"
        " ORDER BY su.position FOR UPDATE OF su"),
        {"s": sess["id"], "p": run["phase_id"]}).mappings().all()
    for u in units:
        if answers is not None:
            amap = answers.get(u["id"], {})
        else:
            amap = {r["question_id"]: r["chosen_option_id"]
                    for r in conn.execute(text(
                        "SELECT question_id, chosen_option_id"
                        " FROM study_answer_drafts"
                        " WHERE session_unit_id = :u"
                        "   AND chosen_option_id IS NOT NULL"),
                        {"u": u["id"]}).mappings()}
        _judge_and_store_unit(conn, u["release_id"], u["unit_id"], u["id"],
                              amap, user_id, refresh_progress=False)
    conn.execute(text(
        "UPDATE study_phase_runs SET closed_at = :t WHERE id = :i"),
        {"t": closed_at, "i": run["id"]})
    pos = conn.execute(text(
        "SELECT position FROM release_exam_phases"
        " WHERE release_id = :r AND phase_id = :p"),
        {"r": sess["release_id"], "p": run["phase_id"]}).scalar()
    nxt = _next_phase(conn, sess["release_id"], pos)
    if nxt is not None:
        _start_run(conn, sess["id"], sess["release_id"], nxt, closed_at)
    else:
        _complete_session(conn, sess["id"], SCORING_METHOD)


def _advance(conn, sess: dict, user_id: uuid.UUID) -> None:
    """Seal every Phase whose server time is up (chained from its expiry)."""
    if sess["state"] != "in_progress":
        return
    while True:
        run = conn.execute(text(
            "SELECT id, phase_id, expires_at, expires_at <= now() AS over"
            " FROM study_phase_runs"
            " WHERE session_id = :s AND closed_at IS NULL"),
            {"s": sess["id"]}).mappings().first()
        if run is None or not run["over"]:
            return
        _close_phase(conn, sess, user_id, run, None, run["expires_at"])
        state = conn.execute(text(
            "SELECT state FROM study_sessions WHERE id = :s"),
            {"s": sess["id"]}).scalar()
        if state != "in_progress":
            sess["state"] = state
            return


def _state(conn, session_id: uuid.UUID) -> dict:
    head = conn.execute(text(
        "SELECT s.id, s.state, s.created_at, s.ended_at,"
        " s.mock_release_id AS release_id, r.exam_id, e.title, e.level,"
        " now() AS server_now"
        " FROM study_sessions s"
        " JOIN exam_releases r ON r.id = s.mock_release_id"
        " JOIN exam_catalogs e ON e.id = r.exam_id WHERE s.id = :s"),
        {"s": session_id}).mappings().first()
    runs = {r["phase_id"]: r for r in conn.execute(text(
        "SELECT phase_id, started_at, expires_at, closed_at"
        " FROM study_phase_runs WHERE session_id = :s"),
        {"s": session_id}).mappings()}
    phases_rows = conn.execute(text(
        "SELECT p.phase_id, p.position, p.title, p.duration_seconds,"
        " p.playback_policy,"
        " (SELECT count(*) FROM release_phase_units pu"
        "  WHERE pu.release_id = p.release_id AND pu.phase_id = p.phase_id)"
        "   AS unit_count"
        " FROM release_exam_phases p WHERE p.release_id = :r"
        " ORDER BY p.position"), {"r": head["release_id"]}).mappings().all()
    now = head["server_now"]
    phases = []
    active_id = None
    for p in phases_rows:
        run = runs.get(p["phase_id"])
        if run is None:
            status = "upcoming"
        elif run["closed_at"] is not None:
            status = "closed"
        elif head["state"] == "in_progress":
            status = "active"
            active_id = p["phase_id"]
        else:
            status = "closed" if head["state"] == "completed" else "upcoming"
        entry = {"phase_id": p["phase_id"], "position": p["position"],
                 "title": p["title"], "duration_seconds": p["duration_seconds"],
                 "playback_policy": p["playback_policy"],
                 "unit_count": p["unit_count"], "status": status,
                 "started_at": None, "expires_at": None,
                 "remaining_seconds": None}
        if status == "active":
            entry["started_at"] = run["started_at"].isoformat()
            entry["expires_at"] = run["expires_at"].isoformat()
            entry["remaining_seconds"] = max(
                0, int((run["expires_at"] - now).total_seconds()))
        phases.append(entry)
    active_units = []
    if active_id is not None and head["state"] == "in_progress":
        active_units = [{
            "session_unit_id": str(u["id"]), "unit_id": u["unit_id"],
            "position": u["position"], "state": u["state"],
        } for u in conn.execute(text(
            "SELECT su.id, su.unit_id, su.position, su.state"
            " FROM study_session_units su"
            " JOIN release_phase_units pu ON pu.release_id = su.release_id"
            "  AND pu.unit_id = su.unit_id AND pu.phase_id = :p"
            " WHERE su.session_id = :s ORDER BY su.position"),
            {"p": active_id, "s": session_id}).mappings()]
    return {
        "id": str(head["id"]), "mode": "mock", "state": head["state"],
        "exam_id": head["exam_id"], "exam_title": head["title"],
        "level": head["level"], "release_id": str(head["release_id"]),
        "created_at": head["created_at"].isoformat(),
        "ended_at": head["ended_at"].isoformat() if head["ended_at"] else None,
        "server_now": now.isoformat(),
        "active_phase_id": active_id,
        "phases": phases, "active_units": active_units,
        "results_available": head["state"] == "completed",
    }


# -------------------------------------------------------------------- API ----

class MockCreate(BaseModel):
    exam_id: str
    replace_active: bool = False   # explicit consent to abandon a running mock


@router.post("/api/mock-exams", status_code=201)
def create_mock_exam(body: MockCreate,
                     user_id: uuid.UUID = Depends(get_current_user_id)) -> dict:
    """Start a strict mock of the exam's current release. Independent of
    practice; a running mock must be continued or explicitly replaced."""
    for attempt in (1, 2):
        try:
            return _create(body.exam_id, user_id, body.replace_active)
        except IntegrityError:
            if attempt == 2:
                raise HTTPException(
                    status_code=409,
                    detail={"code": "session_replace_conflict",
                            "message": "concurrent start; retry"})
    raise AssertionError("unreachable")


def _create(exam_id: str, user_id: uuid.UUID, replace_active: bool) -> dict:
    with get_engine().begin() as conn:
        plan = _plan(conn, exam_id)
        if not plan["available"]:
            raise HTTPException(
                status_code=422,
                detail={"code": "mock_not_available",
                        "message": "this exam cannot be taken as a mock",
                        "reason": plan["reason"]})
        rid = uuid.UUID(plan["release_id"])
        running = conn.execute(text(
            "SELECT id FROM study_sessions WHERE user_id = :u"
            " AND mode = 'mock' AND state = 'in_progress' FOR UPDATE"),
            {"u": user_id}).scalar()
        if running is not None:
            # a run whose time is up is already over: seal it first
            _owned_advanced(conn, running, user_id)
            running = conn.execute(text(
                "SELECT s.id, r.exam_id FROM study_sessions s"
                " JOIN exam_releases r ON r.id = s.mock_release_id"
                " WHERE s.id = :i AND s.state = 'in_progress'"),
                {"i": running}).mappings().first()
        if running is not None:
            if not replace_active:
                raise HTTPException(
                    status_code=409,
                    detail={"code": "mock_in_progress",
                            "message": "a mock exam is already in progress",
                            "session_id": str(running["id"]),
                            "exam_id": running["exam_id"]})
            conn.execute(text(
                "UPDATE study_sessions SET state = 'abandoned',"
                " ended_at = now(), version = version + 1"
                " WHERE id = :i"), {"i": running["id"]})
        sid = conn.execute(text(
            "INSERT INTO study_sessions (id, user_id, mode, feedback_mode,"
            " state, mock_release_id, config)"
            " VALUES (gen_random_uuid(), :u, 'mock', 'end', 'in_progress',"
            " :r, CAST(:cfg AS jsonb)) RETURNING id"),
            {"u": user_id, "r": rid, "cfg": json.dumps({
                "mock": {"exam_id": exam_id,
                         "phases": [p["phase_id"] for p in plan["phases"]]}})
             }).scalar()
        units = conn.execute(text(
            "SELECT pu.unit_id FROM release_phase_units pu"
            " JOIN release_exam_phases p ON p.release_id = pu.release_id"
            "  AND p.phase_id = pu.phase_id"
            " WHERE pu.release_id = :r ORDER BY p.position, pu.position"),
            {"r": rid}).scalars().all()
        for pos, uid in enumerate(units, start=1):
            conn.execute(text(
                "INSERT INTO study_session_units (id, session_id, release_id,"
                " unit_id, position, state)"
                " VALUES (gen_random_uuid(), :s, :r, :u, :p, 'pending')"),
                {"s": sid, "r": rid, "u": uid, "p": pos})
        first = plan["phases"][0]
        _start_run(conn, sid, rid, first, conn.execute(
            text("SELECT now()")).scalar())
        return _state(conn, sid)


def _owned_advanced(conn, session_id, user_id) -> dict:
    sess = _lock_session(conn, session_id, user_id)
    _advance(conn, sess, user_id)
    return sess


@router.get("/api/mock-exams/current")
def get_current_mock(user_id: uuid.UUID = Depends(get_current_user_id)) -> dict:
    with get_engine().begin() as conn:
        sid = conn.execute(text(
            "SELECT id FROM study_sessions WHERE user_id = :u"
            " AND mode = 'mock' AND state = 'in_progress'"),
            {"u": user_id}).scalar()
        if sid is None:
            raise HTTPException(status_code=404, detail="no active mock exam")
        _owned_advanced(conn, sid, user_id)
        return _state(conn, sid)


@router.get("/api/mock-exams/{session_id}")
def get_mock_exam(session_id: uuid.UUID,
                  user_id: uuid.UUID = Depends(get_current_user_id)) -> dict:
    """Authoritative state incl. server clock; reading it also seals any
    expired Phase, so a refresh/reconnect can never extend the time."""
    with get_engine().begin() as conn:
        _owned_advanced(conn, session_id, user_id)
        return _state(conn, session_id)


def _active_unit(conn, sess: dict, session_id, session_unit_id) -> dict:
    if sess["state"] != "in_progress":
        raise HTTPException(
            status_code=409,
            detail={"code": "session_not_active",
                    "message": "the mock exam is no longer in progress"})
    unit = conn.execute(text(
        "SELECT su.id, su.release_id, su.unit_id, su.state"
        " FROM study_session_units su"
        " JOIN release_phase_units pu ON pu.release_id = su.release_id"
        "  AND pu.unit_id = su.unit_id"
        " JOIN study_phase_runs pr ON pr.session_id = su.session_id"
        "  AND pr.phase_id = pu.phase_id AND pr.closed_at IS NULL"
        " WHERE su.session_id = :s AND su.id = :u"),
        {"s": session_id, "u": session_unit_id}).mappings().first()
    if unit is None:
        # either not this session's unit, or its Phase is not the active one;
        # one response so a future Phase's content is never confirmed
        raise HTTPException(
            status_code=409,
            detail={"code": "unit_not_in_active_phase",
                    "message": "this unit is not available right now"})
    return dict(unit)


@router.get("/api/mock-exams/{session_id}/units/{session_unit_id}")
def get_mock_unit(session_id: uuid.UUID, session_unit_id: uuid.UUID,
                  user_id: uuid.UUID = Depends(get_current_user_id)) -> dict:
    """Answer-free Unit content, only while its Phase is the active one."""
    with get_engine().begin() as conn:
        sess = _owned_advanced(conn, session_id, user_id)
        unit = _active_unit(conn, sess, session_id, session_unit_id)
        payload = _load_unit_payload(conn, str(unit["release_id"]),
                                     unit["unit_id"], include_private=False)
    payload["session_unit_id"] = str(session_unit_id)
    return payload


@router.get("/api/mock-exams/{session_id}/content")
def get_mock_phase_content(
        session_id: uuid.UUID,
        user_id: uuid.UUID = Depends(get_current_user_id)) -> dict:
    """Answer-free content of EVERY unit of the ACTIVE Phase in one call
    (what the exam page renders), each tagged with its 大题 (layer) so the
    answer sheet can group by the paper's own structure."""
    with get_engine().begin() as conn:
        sess = _owned_advanced(conn, session_id, user_id)
        if sess["state"] != "in_progress":
            raise HTTPException(
                status_code=409,
                detail={"code": "session_not_active",
                        "message": "the mock exam is no longer in progress"})
        phase_id = conn.execute(text(
            "SELECT phase_id FROM study_phase_runs"
            " WHERE session_id = :s AND closed_at IS NULL"),
            {"s": session_id}).scalar()
        rows = conn.execute(text(
            "SELECT su.id, su.release_id, su.unit_id, su.state,"
            " l.layer_id, l.display_label, l.position AS layer_position,"
            " sec.subject, sec.title AS section_title"
            " FROM study_session_units su"
            " JOIN release_phase_units pu ON pu.release_id = su.release_id"
            "  AND pu.unit_id = su.unit_id AND pu.phase_id = :p"
            " JOIN release_units u ON u.release_id = su.release_id"
            "  AND u.unit_id = su.unit_id"
            " JOIN release_layers l ON l.release_id = u.release_id"
            "  AND l.layer_id = u.layer_id"
            " JOIN release_sections sec ON sec.release_id = l.release_id"
            "  AND sec.section_id = l.section_id"
            " WHERE su.session_id = :s ORDER BY su.position"),
            {"p": phase_id, "s": session_id}).mappings().all()
        units = []
        for r in rows:
            payload = _load_unit_payload(conn, str(r["release_id"]),
                                         r["unit_id"], include_private=False)
            payload["session_unit_id"] = str(r["id"])
            payload["session_unit_state"] = r["state"]
            payload["layer"] = {
                "layer_id": r["layer_id"], "label": r["display_label"],
                "position": r["layer_position"], "subject": r["subject"],
                "section_title": r["section_title"]}
            units.append(payload)
    return {"phase_id": phase_id, "units": units}


@router.put("/api/mock-exams/{session_id}/units/{session_unit_id}/drafts")
def save_mock_draft(session_id: uuid.UUID, session_unit_id: uuid.UUID,
                    body: DraftSave,
                    user_id: uuid.UUID = Depends(get_current_user_id)) -> dict:
    with get_engine().begin() as conn:
        sess = _owned_advanced(conn, session_id, user_id)
        unit = _active_unit(conn, sess, session_id, session_unit_id)
        return _save_draft(conn, unit, session_unit_id, body)


@router.get("/api/mock-exams/{session_id}/drafts")
def list_mock_drafts(session_id: uuid.UUID,
                     user_id: uuid.UUID = Depends(get_current_user_id)) -> dict:
    """Refresh-restore: drafts of the ACTIVE Phase only (closed Phases are
    final and never editable)."""
    with get_engine().begin() as conn:
        sess = _owned_advanced(conn, session_id, user_id)
        rows = []
        if sess["state"] == "in_progress":
            rows = conn.execute(text(
                "SELECT su.id AS session_unit_id, su.unit_id, su.position,"
                " d.question_id, d.chosen_option_id, d.row_version,"
                " d.updated_at FROM study_answer_drafts d"
                " JOIN study_session_units su ON su.id = d.session_unit_id"
                " JOIN release_phase_units pu ON pu.release_id = su.release_id"
                "  AND pu.unit_id = su.unit_id"
                " JOIN study_phase_runs pr ON pr.session_id = su.session_id"
                "  AND pr.phase_id = pu.phase_id AND pr.closed_at IS NULL"
                " WHERE su.session_id = :s ORDER BY su.position, d.question_id"),
                {"s": session_id}).mappings().all()
    return {"drafts": [{
        "session_unit_id": str(r["session_unit_id"]), "unit_id": r["unit_id"],
        "unit_position": r["position"], "question_id": r["question_id"],
        "chosen_option_id": r["chosen_option_id"],
        "row_version": r["row_version"],
        "updated_at": r["updated_at"].isoformat()} for r in rows]}


class PhaseSubmit(BaseModel):
    answers: list[FinalAnswer]  # questions absent = skip


@router.post("/api/mock-exams/{session_id}/phases/{phase_id}/submit")
def submit_mock_phase(session_id: uuid.UUID, phase_id: str, body: PhaseSubmit,
                      user_id: uuid.UUID = Depends(get_current_user_id)) -> dict:
    """Formally submit (close) one Phase. The Phase is named in the path so a
    double-click or retry can never close the NEXT Phase: a Phase that is
    already closed answers idempotently with the current state."""
    with get_engine().begin() as conn:
        sess = _owned_advanced(conn, session_id, user_id)
        run = conn.execute(text(
            "SELECT id, phase_id, closed_at FROM study_phase_runs"
            " WHERE session_id = :s AND phase_id = :p"),
            {"s": session_id, "p": phase_id}).mappings().first()
        known = conn.execute(text(
            "SELECT 1 FROM release_exam_phases"
            " WHERE release_id = :r AND phase_id = :p"),
            {"r": sess["release_id"], "p": phase_id}).scalar()
        if not known:
            raise HTTPException(status_code=404, detail="phase not found")
        if run is None:
            raise HTTPException(
                status_code=409,
                detail={"code": "phase_not_started",
                        "message": "this phase has not started yet"})
        if run["closed_at"] is not None:
            payload = _state(conn, session_id)
            payload["idempotent"] = True
            return payload
        if sess["state"] != "in_progress":     # e.g. replaced (abandoned)
            raise HTTPException(
                status_code=409,
                detail={"code": "session_not_active",
                        "message": "the mock exam is no longer in progress"})

        allowed = set(conn.execute(text(
            "SELECT su.id FROM study_session_units su"
            " JOIN release_phase_units pu ON pu.release_id = su.release_id"
            "  AND pu.unit_id = su.unit_id AND pu.phase_id = :p"
            " WHERE su.session_id = :s"),
            {"p": phase_id, "s": session_id}).scalars())
        answers: dict = {}
        for a in body.answers:
            if a.session_unit_id not in allowed:
                raise HTTPException(
                    status_code=422,
                    detail={"code": "session_unit_not_in_phase",
                            "message": "answer references a unit outside this"
                                       " phase",
                            "session_unit_id": str(a.session_unit_id)})
            answers.setdefault(a.session_unit_id, {})[a.question_id] = \
                a.chosen_option_id
        now = conn.execute(text("SELECT now()")).scalar()
        _close_phase(conn, sess, user_id, dict(run), answers, now)
        _advance(conn, {**sess, "state": conn.execute(text(
            "SELECT state FROM study_sessions WHERE id = :s"),
            {"s": session_id}).scalar()}, user_id)
        payload = _state(conn, session_id)
        payload["idempotent"] = False
        return payload


@router.get("/api/mock-exams/{session_id}/results")
def get_mock_results(session_id: uuid.UUID,
                     user_id: uuid.UUID = Depends(get_current_user_id)) -> dict:
    """Result + per-question review, ONLY after the last Phase is closed.
    Per-Phase / per-subject correct counts and accuracy; no converted scores."""
    with get_engine().begin() as conn:
        sess = _owned_advanced(conn, session_id, user_id)
        if sess["state"] != "completed":
            raise HTTPException(
                status_code=409,
                detail={"code": "mock_not_finished",
                        "message": "results are available after the last"
                                   " phase is closed"})
        payload = _build_results(conn, session_id)
        rows = conn.execute(text(
            "SELECT p.phase_id, p.position, p.title,"
            " count(*) FILTER (WHERE sa.is_correct IS TRUE) AS correct,"
            " count(*) FILTER (WHERE sa.is_correct IS FALSE) AS wrong,"
            " count(*) FILTER (WHERE sa.is_correct IS NULL) AS skipped,"
            " count(*) AS total"
            " FROM study_submitted_answers sa"
            " JOIN study_session_units su ON su.id = sa.session_unit_id"
            " JOIN release_phase_units pu ON pu.release_id = su.release_id"
            "  AND pu.unit_id = su.unit_id"
            " JOIN release_exam_phases p ON p.release_id = pu.release_id"
            "  AND p.phase_id = pu.phase_id"
            " WHERE su.session_id = :s"
            " GROUP BY p.phase_id, p.position, p.title ORDER BY p.position"),
            {"s": session_id}).mappings().all()
        subj = conn.execute(text(
            "SELECT qt.subject,"
            " count(*) FILTER (WHERE sa.is_correct IS TRUE) AS correct,"
            " count(*) FILTER (WHERE sa.is_correct IS FALSE) AS wrong,"
            " count(*) FILTER (WHERE sa.is_correct IS NULL) AS skipped,"
            " count(*) AS total"
            " FROM study_submitted_answers sa"
            " JOIN study_session_units su ON su.id = sa.session_unit_id"
            " JOIN release_questions q ON q.release_id = sa.release_id"
            "  AND q.question_id = sa.question_id"
            " JOIN question_types qt ON qt.id = q.question_type_id"
            " WHERE su.session_id = :s GROUP BY qt.subject ORDER BY qt.subject"),
            {"s": session_id}).mappings().all()

    def fold(r) -> dict:
        c, w = int(r["correct"]), int(r["wrong"])
        return {"correct": c, "wrong": w, "skipped": int(r["skipped"]),
                "total": int(r["total"]),
                "answered_accuracy": round(c / (c + w), 4) if c + w else None}

    payload["session_id"] = str(session_id)
    payload["release_id"] = str(sess["release_id"])
    payload["phases"] = [{"phase_id": r["phase_id"], "title": r["title"],
                          **fold(r)} for r in rows]
    payload["subjects"] = [{"subject": r["subject"], **fold(r)} for r in subj]
    return payload
