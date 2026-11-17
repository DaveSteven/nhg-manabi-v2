"""专项练习 (topic practice): question-type catalog + smart-sampled sessions.

Stage 1 (catalog): per level, every Canonical question type that has at
least one complete Unit in a CURRENT published release, with real counts.
Types come from `question_types` / `release_units.question_type_id`, never
from the printed 問題 number.

Stage 2 (sampling): the server — never the client — picks whole Units of
ONE question type across exams/releases, weighted by the caller's formal
practice history (submitted answers only; drafts never count), then creates
an ordinary `practice` session through the same transaction used by
POST /api/practice/sessions. Starting one abandons the user's previous
in-progress practice atomically (ADR-0016); no conflict, no prompt. Reuses
release pinning per Unit, draft/submit/feedback gates and results. The
response carries ids only; answers are never part of it.
"""
import random
import uuid
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text

from app.api.practice import (MAX_SESSION_UNITS, PracticeSessionCreate,
                              SessionUnitRequest, _create_session_tx)
from app.auth import get_current_user_id
from app.db.engine import get_engine
from app.topic_sampling import Candidate, UnitHistory, select_units

router = APIRouter()

Level = Literal["N1", "N2", "N3", "N4", "N5"]

_CANDIDATES_SQL = (
    "SELECT u.release_id, u.unit_id, r.exam_id, u.question_type_id,"
    " (SELECT count(*) FROM release_questions q"
    "  WHERE q.release_id = u.release_id AND q.unit_id = u.unit_id)"
    "   AS question_count"
    " FROM release_units u"
    " JOIN exam_releases r ON r.id = u.release_id"
    " JOIN exam_current_releases c ON c.release_id = r.id"
    " JOIN exam_catalogs e ON e.id = r.exam_id"
    " WHERE e.level = :level AND r.state = 'published'"
    "   AND u.conversion_status = 'complete'")

# Formal history only: submitted session units of practice/quick sessions.
_HISTORY_SQL = (
    "WITH sub AS ("
    " SELECT er.exam_id, su.unit_id, count(*) AS submitted_count,"
    "  max(su.submitted_at) AS last_at"
    " FROM study_session_units su"
    " JOIN study_sessions s ON s.id = su.session_id"
    " JOIN exam_releases er ON er.id = su.release_id"
    " JOIN exam_catalogs e ON e.id = er.exam_id"
    " WHERE s.user_id = :u AND s.mode IN ('practice', 'quick_practice')"
    "   AND su.state = 'submitted' AND e.level = :level"
    " GROUP BY er.exam_id, su.unit_id),"
    " latest AS ("
    " SELECT DISTINCT ON (er.exam_id, sa.question_id)"
    "  er.exam_id, sa.unit_id, sa.is_correct"
    " FROM study_submitted_answers sa"
    " JOIN study_session_units su ON su.id = sa.session_unit_id"
    " JOIN study_sessions s ON s.id = su.session_id"
    " JOIN exam_releases er ON er.id = sa.release_id"
    " JOIN exam_catalogs e ON e.id = er.exam_id"
    " WHERE s.user_id = :u AND s.mode IN ('practice', 'quick_practice')"
    "   AND sa.chosen_option_id IS NOT NULL AND e.level = :level"
    " ORDER BY er.exam_id, sa.question_id, sa.submitted_at DESC),"
    " agg AS ("
    " SELECT exam_id, unit_id, count(*) AS answered,"
    "  count(*) FILTER (WHERE NOT is_correct) AS latest_wrong"
    " FROM latest GROUP BY exam_id, unit_id)"
    " SELECT sub.exam_id, sub.unit_id, sub.submitted_count, sub.last_at,"
    "  coalesce(agg.answered, 0) AS answered,"
    "  coalesce(agg.latest_wrong, 0) AS latest_wrong"
    " FROM sub LEFT JOIN agg"
    "  ON agg.exam_id = sub.exam_id AND agg.unit_id = sub.unit_id")


def _history_map(conn, user_id: uuid.UUID, level: str) -> dict:
    rows = conn.execute(text(_HISTORY_SQL),
                        {"u": user_id, "level": level}).mappings().all()
    return {(r["exam_id"], r["unit_id"]): UnitHistory(
        submitted_count=r["submitted_count"], answered=r["answered"],
        latest_wrong=r["latest_wrong"], last_submitted_at=r["last_at"])
        for r in rows}


@router.get("/api/topic-practice/types")
def list_topic_types(
    level: Level,
    user_id: uuid.UUID = Depends(get_current_user_id),
) -> dict:
    with get_engine().connect() as conn:
        cands = conn.execute(text(_CANDIDATES_SQL),
                             {"level": level}).mappings().all()
        history = _history_map(conn, user_id, level)
        types = conn.execute(text(
            "SELECT id, subject, label_zh, label_ja, default_unit_kind,"
            " is_provisional FROM question_types ORDER BY subject, id"
        )).mappings().all()
    stats: dict[str, dict] = {}
    for c in cands:
        s = stats.setdefault(c["question_type_id"], {
            "units": 0, "questions": 0, "new": 0})
        s["units"] += 1
        s["questions"] += c["question_count"]
        h = history.get((c["exam_id"], c["unit_id"]))
        if h is None or h.submitted_count == 0:
            s["new"] += 1
    return {"level": level, "types": [{
        "question_type_id": t["id"], "subject": t["subject"],
        "label_zh": t["label_zh"], "label_ja": t["label_ja"],
        "unit_kind": t["default_unit_kind"],
        "is_provisional": t["is_provisional"],
        "available_units": stats[t["id"]]["units"],
        "available_questions": stats[t["id"]]["questions"],
        "new_units": stats[t["id"]]["new"],
    } for t in types if t["id"] in stats]}


class TopicSessionCreate(BaseModel):
    level: Level
    question_type_id: str
    count: int = Field(ge=1, le=MAX_SESSION_UNITS)
    feedback_mode: Literal["immediate", "end"]


@router.post("/api/topic-practice/sessions", status_code=201)
def create_topic_session(
    body: TopicSessionCreate,
    user_id: uuid.UUID = Depends(get_current_user_id),
) -> dict:
    engine = get_engine()
    with engine.connect() as conn:
        cands = [c for c in conn.execute(text(_CANDIDATES_SQL),
                                         {"level": body.level}).mappings()
                 if c["question_type_id"] == body.question_type_id]
        history = _history_map(conn, user_id, body.level)
    if not cands:
        raise HTTPException(status_code=422, detail={
            "code": "no_candidates",
            "message": "no practicable units for this level and type"})
    if body.count > len(cands):
        raise HTTPException(status_code=422, detail={
            "code": "count_exceeds_available",
            "message": "requested more units than available",
            "available_units": len(cands)})
    pool = [Candidate(str(c["release_id"]), c["unit_id"], c["exam_id"],
                      history.get((c["exam_id"], c["unit_id"])))
            for c in cands]
    picked = select_units(pool, body.count, datetime.now(timezone.utc),
                          random.Random())
    create = PracticeSessionCreate(
        feedback_mode=body.feedback_mode,
        units=[SessionUnitRequest(release_id=uuid.UUID(c.release_id),
                                  unit_id=c.unit_id) for c in picked])
    topic = {"kind": "topic", "level": body.level,
             "question_type_id": body.question_type_id,
             "requested_count": body.count}
    return _create_session_tx(engine, create, user_id,
                              config_extra={"topic": topic})
