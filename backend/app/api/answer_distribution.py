"""历年答案分布: how often each option position is the keyed answer.

Aggregate only — (level, question type, option position) → count over the
CURRENT published past/mock papers' complete Units. It never returns a
question, unit, paper or year, so it cannot reveal the answer of any
specific question (student answer-visibility rule). Keys that are
`needs_review`/`blocked` are excluded; under PUBLISH_POLICY=auto the rest
are published-but-unverified, which the UI states.
"""
import uuid

from fastapi import APIRouter, Depends
from sqlalchemy import text

from app.api.topic_practice import type_sort_key
from app.auth import get_current_user_id
from app.db.engine import get_engine

router = APIRouter()

_SQL = (
    "SELECT e.level, q.question_type_id, o.position, count(*) AS n"
    " FROM release_answer_keys k"
    " JOIN release_options o ON o.release_id = k.release_id"
    "  AND o.question_id = k.question_id AND o.option_id = k.correct_option_id"
    " JOIN release_questions q ON q.release_id = k.release_id"
    "  AND q.question_id = k.question_id"
    " JOIN release_units u ON u.release_id = q.release_id AND u.unit_id = q.unit_id"
    " JOIN exam_current_releases c ON c.release_id = k.release_id"
    " JOIN exam_releases r ON r.id = k.release_id"
    " JOIN exam_catalogs e ON e.id = r.exam_id"
    " WHERE r.state = 'published' AND e.kind IN ('past_exam', 'mock_exam')"
    "   AND u.conversion_status = 'complete'"
    "   AND q.conversion_status = 'complete'"
    "   AND k.review_status NOT IN ('needs_review', 'blocked')"
    " GROUP BY e.level, q.question_type_id, o.position")


@router.get("/api/answer-distribution")
def answer_distribution(user_id: uuid.UUID = Depends(get_current_user_id)) -> dict:
    with get_engine().connect() as conn:
        rows = conn.execute(text(_SQL)).mappings().all()
        types = conn.execute(text(
            "SELECT id, subject, label_zh FROM question_types")).mappings().all()
    present = {r["question_type_id"] for r in rows}
    return {
        "types": [{"question_type_id": t["id"], "subject": t["subject"],
                   "label_zh": t["label_zh"]}
                  for t in sorted(types, key=lambda t: type_sort_key(t["id"]))
                  if t["id"] in present],
        "counts": [{"level": r["level"], "question_type_id": r["question_type_id"],
                    "position": r["position"], "count": r["n"]} for r in rows],
    }
