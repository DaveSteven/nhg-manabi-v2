"""扩展练习 (supplementary practice, ADR-0030): lesson catalog + start a lesson.

Content is V1 textbook lessons published as `supplementary` exams (one lesson
= one exam, single-question units). This is an independent entry: these exams
never appear in the 历年试卷 catalog, in 专项练习 sampling, or in 我的学习
statistics/history. Starting a lesson creates an ordinary `practice` session
(same transaction, answer flow and feedback gates as every other practice;
ADR-0016: the user's previous in-progress practice is abandoned atomically)
whose units are ALL practicable units of the lesson's current release in
order. The response carries ids only; answers are never part of it.
"""
import re
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text

from app.api.practice import (PracticeSessionCreate, SessionUnitRequest,
                              _create_session_tx)
from app.auth import get_current_user_id
from app.db.engine import get_engine

router = APIRouter()

Level = Literal["N1", "N2", "N3", "N4", "N5"]
_EXAM_ID_RE = re.compile(r"^JLPTGO-SUP-(N[1-5])-([a-z]+)-L(\d+)$")
SUBJECTS = (("kanji", "汉字"), ("vocabulary", "词汇"), ("grammar", "语法"))
_LABEL = dict(SUBJECTS)

_LESSONS_SQL = (
    "SELECT r.exam_id, r.id AS release_id, e.title,"
    " count(q.question_id) AS question_count,"
    " count(p.question_id) FILTER (WHERE p.last_valid_result IS NOT NULL) AS answered,"
    " count(p.question_id) FILTER (WHERE p.last_valid_result IS TRUE) AS correct,"
    " count(p.question_id) FILTER (WHERE p.last_valid_result IS FALSE) AS wrong"
    " FROM exam_current_releases c"
    " JOIN exam_releases r ON r.id = c.release_id AND r.state = 'published'"
    " JOIN exam_catalogs e ON e.id = r.exam_id AND e.kind = 'supplementary'"
    " JOIN release_units u ON u.release_id = r.id"
    "  AND u.conversion_status = 'complete'"
    " JOIN release_questions q ON q.release_id = u.release_id AND q.unit_id = u.unit_id"
    " LEFT JOIN user_question_progress p"
    "  ON p.question_id = q.question_id AND p.user_id = :u"
    " WHERE e.level = :level"
    " GROUP BY r.exam_id, r.id, e.title")


@router.get("/api/supplementary/lessons")
def list_lessons(level: Level, user_id: uuid.UUID = Depends(get_current_user_id)) -> dict:
    with get_engine().connect() as conn:
        rows = conn.execute(text(_LESSONS_SQL),
                            {"level": level, "u": user_id}).mappings().all()
    by_subject: dict[str, list[dict]] = {}
    for r in rows:
        m = _EXAM_ID_RE.match(r["exam_id"])
        if m is None or m.group(2) not in _LABEL:
            continue
        by_subject.setdefault(m.group(2), []).append({
            "exam_id": r["exam_id"], "lesson": int(m.group(3)),
            "title": r["title"], "question_count": int(r["question_count"]),
            "answered": int(r["answered"]), "correct": int(r["correct"]),
            "wrong": int(r["wrong"])})
    return {"level": level, "subjects": [
        {"subject": key, "label_zh": label,
         "lessons": sorted(by_subject[key], key=lambda x: x["lesson"])}
        for key, label in SUBJECTS if key in by_subject]}


class LessonSessionCreate(BaseModel):
    exam_id: str
    feedback_mode: Literal["immediate", "end"]


@router.post("/api/supplementary/sessions", status_code=201)
def start_lesson(body: LessonSessionCreate,
                 user_id: uuid.UUID = Depends(get_current_user_id)) -> dict:
    m = _EXAM_ID_RE.match(body.exam_id)
    engine = get_engine()
    with engine.connect() as conn:
        units = [] if m is None else conn.execute(text(
            "SELECT r.id AS release_id, u.unit_id"
            " FROM exam_current_releases c"
            " JOIN exam_releases r ON r.id = c.release_id AND r.state = 'published'"
            " JOIN exam_catalogs e ON e.id = r.exam_id AND e.kind = 'supplementary'"
            " JOIN release_units u ON u.release_id = r.id"
            "  AND u.conversion_status = 'complete'"
            " JOIN release_layers l ON l.release_id = u.release_id AND l.layer_id = u.layer_id"
            " WHERE r.exam_id = :e ORDER BY l.position, u.position"),
            {"e": body.exam_id}).mappings().all()
    if not units:
        raise HTTPException(status_code=404, detail={
            "code": "lesson_not_found", "message": "no such practicable lesson"})
    create = PracticeSessionCreate(
        feedback_mode=body.feedback_mode,
        units=[SessionUnitRequest(release_id=u["release_id"], unit_id=u["unit_id"])
               for u in units])
    meta = {"kind": "supplementary", "exam_id": body.exam_id, "level": m.group(1),
            "subject": m.group(2), "lesson": int(m.group(3))}
    return _create_session_tx(engine, create, user_id,
                              config_extra={"supplementary": meta})
