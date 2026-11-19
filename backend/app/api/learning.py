"""我的学习: overview, 练习历史 and 题目记录 (错题策略 B) — read-only.

Single source of truth = the caller's formal submitted answers, through the
derived `user_question_progress` cache (drafts never count; skip is neither
right nor wrong). Everything is scoped to the CURRENT published,
conversion-complete questions of the chosen level, so "coverage" has an
honest denominator. Own data only; no endpoint here returns answers,
explanations, chosen options or prompts (review stays in the session pages).

Statistics (business-rules, never mixed):
- 已作答正确率 = correct / (correct + wrong), skips excluded; no answers → null
  (shown as “—”, never 0%).
- 覆盖率 = distinct questions with ≥1 valid formal answer / questions in scope.
- Weak types: only types with a wrong answer AND accuracy below
  WEAK_ACCURACY_BELOW are listed (the list is never padded with strong types),
  at most MAX_WEAK_TYPES. Types with fewer than MIN_WEAK_SAMPLE valid answers
  are flagged `low_sample` (UI: 「数据较少」) and ranked after reliable ones;
  fewer than MIN_WEAK_ATTEMPTS are not listed.
Time range is all-time for now (the range is still an open product question).
"""
import uuid
from datetime import timedelta
from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text

from app.auth import get_current_user_id
from app.db.engine import get_engine

router = APIRouter()

Level = Literal["N1", "N2", "N3", "N4", "N5"]
Subject = Literal["vocabulary", "grammar", "reading", "listening"]
RecordFilter = Literal["ever_wrong", "still_wrong", "recovered"]

# Tunable thresholds, not product rules (time range / weights still open).
MIN_WEAK_SAMPLE = 5        # >= this many valid answers: a reliable verdict
MIN_WEAK_ATTEMPTS = 3      # fewer than this: never listed at all
WEAK_ACCURACY_BELOW = 0.75  # only types clearly below this are "weak"
MAX_WEAK_TYPES = 3

# Practicable questions of the CURRENT published releases (same gate as the
# public API: conversion-complete units only).
_CUR = (
    "SELECT q.question_id, q.question_type_id, q.unit_id, q.printed_number,"
    " q.release_id,"
    " r.exam_id, e.level, e.year, e.month, e.title AS exam_title,"
    " qt.subject, qt.label_zh, l.display_label"
    " FROM release_questions q"
    " JOIN exam_current_releases c ON c.release_id = q.release_id"
    " JOIN exam_releases r ON r.id = q.release_id AND r.state = 'published'"
    " JOIN exam_catalogs e ON e.id = r.exam_id"
    " JOIN release_units u ON u.release_id = q.release_id"
    "  AND u.unit_id = q.unit_id AND u.conversion_status = 'complete'"
    " JOIN release_layers l ON l.release_id = u.release_id"
    "  AND l.layer_id = u.layer_id"
    " JOIN question_types qt ON qt.id = q.question_type_id"
    " WHERE e.kind IN ('past_exam', 'mock_exam')"  # 扩展练习 stays out (ADR-0030)
    "   AND (CAST(:level AS text) IS NULL OR e.level = :level)")


def _accuracy(correct: int, wrong: int) -> float | None:
    return correct / (correct + wrong) if correct + wrong > 0 else None


@router.get("/api/me/learning/overview")
def learning_overview(
    level: Level | None = None,
    user_id: uuid.UUID = Depends(get_current_user_id),
) -> dict:
    by_type_sql = (
        f"WITH cur AS ({_CUR})"
        " SELECT cur.question_type_id, cur.subject, cur.label_zh,"
        "  count(*) AS total,"
        "  count(*) FILTER (WHERE p.attempt_count > 0) AS practiced,"
        "  coalesce(sum(p.correct_count), 0) AS correct,"
        "  coalesce(sum(p.wrong_count), 0) AS wrong,"
        "  coalesce(sum(p.skip_count), 0) AS skipped,"
        "  count(*) FILTER (WHERE p.last_valid_result IS FALSE) AS still_wrong"
        " FROM cur LEFT JOIN user_question_progress p"
        "  ON p.question_id = cur.question_id AND p.user_id = :u"
        " GROUP BY cur.question_type_id, cur.subject, cur.label_zh")
    with get_engine().connect() as conn:
        rows = conn.execute(text(by_type_sql),
                            {"u": user_id, "level": level}).mappings().all()
        # Session-level facts are NOT level-scoped (a session can span
        # levels); the UI labels them “全部等级”.
        completed = conn.execute(text(
            "SELECT count(*) FROM study_sessions WHERE user_id = :u"
            " AND mode IN ('practice', 'quick_practice')"
            " AND config -> 'supplementary' IS NULL"
            " AND config -> 'imported' IS NULL"
            " AND state = 'completed'"), {"u": user_id}).scalar()
        last = conn.execute(text(
            "SELECT max(last_seen_at) FROM user_question_progress"
            " WHERE user_id = :u"), {"u": user_id}).scalar()

    def fold(rs) -> dict:
        c = sum(int(r["correct"]) for r in rs)
        w = sum(int(r["wrong"]) for r in rs)
        return {"attempts": c + w, "correct": c, "wrong": w,
                "skipped": sum(int(r["skipped"]) for r in rs),
                "practiced": sum(int(r["practiced"]) for r in rs),
                "total": sum(int(r["total"]) for r in rs),
                "still_wrong": sum(int(r["still_wrong"]) for r in rs)}

    allr = fold(rows)
    subjects = []
    for s in ("vocabulary", "grammar", "reading", "listening"):
        f = fold([r for r in rows if r["subject"] == s])
        if f["total"] == 0:
            continue
        subjects.append({
            "subject": s, "practiced_questions": f["practiced"],
            "total_questions": f["total"], "attempts": f["attempts"],
            "correct": f["correct"], "wrong": f["wrong"],
            "accuracy": _accuracy(f["correct"], f["wrong"]),
            "still_wrong": f["still_wrong"]})
    weak = []
    for r in rows:
        c, w = int(r["correct"]), int(r["wrong"])
        acc = _accuracy(c, w)
        if c + w >= MIN_WEAK_ATTEMPTS and w > 0 and acc < WEAK_ACCURACY_BELOW:
            weak.append({
                "question_type_id": r["question_type_id"],
                "subject": r["subject"], "label_zh": r["label_zh"],
                "attempts": c + w, "wrong": w, "accuracy": acc,
                "low_sample": c + w < MIN_WEAK_SAMPLE,
                "still_wrong": int(r["still_wrong"])})
    weak.sort(key=lambda x: (x["low_sample"], x["accuracy"], -x["wrong"],
                             x["question_type_id"]))
    return {
        "level": level,
        "totals": {
            "attempts": allr["attempts"], "correct": allr["correct"],
            "wrong": allr["wrong"], "skipped": allr["skipped"],
            "answered_accuracy": _accuracy(allr["correct"], allr["wrong"]),
            "practiced_questions": allr["practiced"],
            "still_wrong_questions": allr["still_wrong"],
            "completed_sessions": int(completed or 0),
            "last_practiced_at": last.isoformat() if last else None},
        "coverage": {
            "practiced_questions": allr["practiced"],
            "total_questions": allr["total"],
            "ratio": allr["practiced"] / allr["total"] if allr["total"] else None},
        "by_subject": subjects,
        "weak_types": weak[:MAX_WEAK_TYPES],
    }


HistoryKind = Literal["all", "quick", "topic", "mock"]

# Finished records only. Practice: completed / ended early. Mock (ADR-0027):
# COMPLETED only — abandoned mocks are never history (ADR-0025).
_HISTORY_WHERE = (
    " WHERE s.user_id = :u AND ("
    "  (s.mode IN ('practice', 'quick_practice')"
    "   AND s.state IN ('completed', 'ended_early'))"
    "  OR (s.mode = 'mock' AND s.state = 'completed'))"
    " AND s.config -> 'supplementary' IS NULL"  # 扩展练习 stays out (ADR-0030)
    " AND s.config -> 'imported' IS NULL"       # V1 per-question answers (ADR-0030)
    " AND (:kind = 'all'"
    "  OR (:kind = 'mock' AND s.mode = 'mock')"
    "  OR (:kind = 'quick' AND s.mode <> 'mock'"
    "      AND s.config -> 'topic' IS NULL)"
    "  OR (:kind = 'topic' AND s.mode <> 'mock'"
    "      AND s.config -> 'topic' IS NOT NULL))")

_HISTORY_SQL = (
    "SELECT s.id, s.mode, s.state, s.feedback_mode, s.config,"
    " coalesce(res.finished_at, s.ended_at, s.created_at) AS happened_at,"
    " a.correct, a.wrong, a.skipped, a.total,"
    " first_unit.exam_id, first_unit.exam_title, first_unit.level,"
    " tqt.label_zh AS topic_label,"
    " count(*) OVER () AS full_count"
    " FROM study_sessions s"
    " LEFT JOIN study_results res ON res.session_id = s.id"
    " JOIN LATERAL ("
    "  SELECT count(*) FILTER (WHERE sa.is_correct IS TRUE) AS correct,"
    "         count(*) FILTER (WHERE sa.is_correct IS FALSE) AS wrong,"
    "         count(*) FILTER (WHERE sa.chosen_option_id IS NULL) AS skipped,"
    "         count(*) AS total"
    "  FROM study_submitted_answers sa"
    "  JOIN study_session_units su ON su.id = sa.session_unit_id"
    "  WHERE su.session_id = s.id) a ON a.total > 0"
    " LEFT JOIN LATERAL ("
    "  SELECT er.exam_id, e.title AS exam_title, e.level"
    "  FROM study_session_units su"
    "  JOIN exam_releases er ON er.id = su.release_id"
    "  JOIN exam_catalogs e ON e.id = er.exam_id"
    "  WHERE su.session_id = s.id ORDER BY su.position LIMIT 1) first_unit"
    "  ON true"
    " LEFT JOIN question_types tqt"
    "  ON tqt.id = s.config -> 'topic' ->> 'question_type_id'"
    f"{_HISTORY_WHERE}"
    " ORDER BY happened_at DESC, s.id"
    " LIMIT :limit OFFSET :offset")


def history_items(rows) -> list[dict]:
    """Shape `_HISTORY_SQL` rows into history entries (shared with admin)."""
    items = []
    for r in rows:
        if r["mode"] == "mock":
            source = {"kind": "mock", "label": r["exam_title"]}
        elif r["topic_label"] is not None:
            source = {"kind": "topic", "label": r["topic_label"]}
        elif r["mode"] == "quick_practice":
            source = {"kind": "quick", "label": r["exam_title"]}
        else:
            source = {"kind": "exam", "label": r["exam_title"]}
        items.append({
            "session_id": str(r["id"]), "mode": r["mode"], "state": r["state"],
            "feedback_mode": r["feedback_mode"],
            "happened_at": r["happened_at"].isoformat(),
            "level": r["level"], "exam_id": r["exam_id"], "source": source,
            "correct": int(r["correct"]), "wrong": int(r["wrong"]),
            "skipped": int(r["skipped"]), "total": int(r["total"]),
            "answered_accuracy": _accuracy(int(r["correct"]), int(r["wrong"])),
            "has_result": r["state"] == "completed"})
    return items


@router.get("/api/me/learning/history")
def learning_history(
    kind: HistoryKind = "all",
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    user_id: uuid.UUID = Depends(get_current_user_id),
) -> dict:
    """Finished practice (completed / ended early) that has at least one
    formal answer, plus COMPLETED strict mocks (ADR-0027); replaced
    (abandoned) or empty sessions are not history. `kind` filters."""
    with get_engine().connect() as conn:
        rows = conn.execute(text(_HISTORY_SQL), {
            "u": user_id, "kind": kind, "limit": limit,
            "offset": offset}).mappings().all()
    items = history_items(rows)
    total = int(rows[0]["full_count"]) if rows else _history_total(user_id, kind)
    return {"total": total, "items": items}


def _history_total(user_id: uuid.UUID, kind: str) -> int:
    """Total when the requested page is past the end (rows empty)."""
    with get_engine().connect() as conn:
        return int(conn.execute(text(
            "SELECT count(*) FROM study_sessions s"
            f"{_HISTORY_WHERE}"
            " AND EXISTS (SELECT 1 FROM study_submitted_answers sa"
            "  JOIN study_session_units su ON su.id = sa.session_unit_id"
            "  WHERE su.session_id = s.id)"),
            {"u": user_id, "kind": kind}).scalar() or 0)


_FILTER_SQL = {
    "ever_wrong": "p.wrong_count > 0",
    "still_wrong": "p.last_valid_result IS FALSE",
    "recovered": "p.wrong_count > 0 AND p.last_valid_result IS TRUE",
}


@router.get("/api/me/learning/questions")
def learning_questions(
    filter: RecordFilter = "ever_wrong",
    level: Level | None = None,
    subject: Subject | None = None,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    user_id: uuid.UUID = Depends(get_current_user_id),
) -> dict:
    """题目记录 (错题策略 B). 曾经答错 = a real wrong choice ever; 最近仍错 =
    the latest VALID answer is wrong; 最近已答对 = wrong before, latest valid
    answer right. Skips change none of these. Rows carry location + counts
    only — reviewing a question goes through its Unit's practice page."""
    sql = (
        f"WITH cur AS ({_CUR})"
        " SELECT cur.*, p.attempt_count, p.wrong_count, p.last_valid_result,"
        "  p.last_answered_at, count(*) OVER () AS full_count"
        " FROM cur JOIN user_question_progress p"
        "  ON p.question_id = cur.question_id AND p.user_id = :u"
        f" WHERE {_FILTER_SQL[filter]}"
        "  AND (CAST(:subject AS text) IS NULL OR cur.subject = :subject)"
        " ORDER BY p.last_answered_at DESC NULLS LAST, cur.question_id"
        " LIMIT :limit OFFSET :offset")
    with get_engine().connect() as conn:
        rows = conn.execute(text(sql), {
            "u": user_id, "level": level, "subject": subject,
            "limit": limit, "offset": offset}).mappings().all()
    return {
        "filter": filter,
        "total": int(rows[0]["full_count"]) if rows else 0,
        "items": [{
            "question_id": r["question_id"], "exam_id": r["exam_id"],
            "release_id": str(r["release_id"]),
            "exam_title": r["exam_title"], "level": r["level"],
            "year": r["year"], "month": r["month"], "unit_id": r["unit_id"],
            "layer_label": r["display_label"],
            "printed_number": r["printed_number"],
            "question_type_id": r["question_type_id"],
            "question_type_label": r["label_zh"], "subject": r["subject"],
            "attempt_count": r["attempt_count"],
            "wrong_count": r["wrong_count"],
            "last_result": ("wrong" if r["last_valid_result"] is False
                            else "correct" if r["last_valid_result"] is True
                            else "none"),
            "last_answered_at": (r["last_answered_at"].isoformat()
                                 if r["last_answered_at"] else None),
        } for r in rows]}


# Study-day boundaries follow the same Asia/Tokyo day as visit tracking.
_STUDY_TZ = "Asia/Tokyo"


@router.get("/api/me/learning/streak")
def learning_streak(user_id: uuid.UUID = Depends(get_current_user_id)) -> dict:
    """Study streak + this Mon–Sun week. A study day = a day with ≥1 formal
    submitted answer that has an actual choice (skips and drafts never
    count). The streak counts back from today; if today has no study yet it
    counts back from yesterday, so it only resets once a whole day is missed.
    """
    with get_engine().connect() as conn:
        today = conn.execute(text(
            f"SELECT (now() AT TIME ZONE '{_STUDY_TZ}')::date")).scalar()
        days = {r[0] for r in conn.execute(text(
            f"SELECT DISTINCT (a.submitted_at AT TIME ZONE '{_STUDY_TZ}')::date"
            " FROM study_submitted_answers a"
            " JOIN study_session_units su ON su.id = a.session_unit_id"
            " JOIN study_sessions s ON s.id = su.session_id"
            " WHERE s.user_id = :u AND a.chosen_option_id IS NOT NULL"
            "  AND a.submitted_at >= now() - interval '800 days'"),
            {"u": user_id})}
    cursor = today if today in days else today - timedelta(days=1)
    streak = 0
    while cursor in days:
        streak += 1
        cursor -= timedelta(days=1)
    monday = today - timedelta(days=today.weekday())
    week = [{"date": (d := monday + timedelta(days=i)).isoformat(),
             "studied": d in days, "is_today": d == today}
            for i in range(7)]
    return {"today": today.isoformat(), "streak_days": streak,
            "studied_today": today in days, "week": week,
            "week_studied": sum(1 for w in week if w["studied"])}
