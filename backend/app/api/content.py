"""Content read API with a hard internal/public boundary.

Public endpoints (student-facing) serve ONLY releases in state='published'
via the exam_current_releases pointer, and NEVER return answer keys,
explanations, provenance or availability metadata.

Internal endpoints serve staged/draft releases to authorized callers
(X-Internal-Token == INTERNAL_API_TOKEN env). Without the token configured
or provided, internal access is refused — 401/403, never a leak.
"""
import os

from fastapi import APIRouter, Header, HTTPException
from sqlalchemy import text

from app.db.engine import get_engine

router = APIRouter()


def _require_internal_token(token: str | None) -> None:
    expected = os.environ.get("INTERNAL_API_TOKEN")
    if not expected:
        raise HTTPException(status_code=403, detail="internal API disabled")
    if token != expected:
        raise HTTPException(status_code=401, detail="invalid internal token")


def _current_release_id(conn, exam_id: str) -> str | None:
    return conn.execute(text(
        "SELECT r.id FROM exam_current_releases c"
        " JOIN exam_releases r ON r.id = c.release_id"
        " WHERE c.exam_id = :e AND r.state = 'published'"),
        {"e": exam_id}).scalar()


def _load_unit_payload(conn, release_id: str, unit_id: str,
                       include_private: bool) -> dict:
    unit = conn.execute(text(
        "SELECT unit_id, layer_id, question_type_id, kind, position, label,"
        " slot_ids, conversion_status FROM release_units"
        " WHERE release_id = :r AND unit_id = :u"),
        {"r": release_id, "u": unit_id}).mappings().first()
    if unit is None:
        return None
    materials = conn.execute(text(
        "SELECT material_id, kind, role, language, content, cues, asset_id"
        " FROM release_unit_materials"
        " WHERE release_id = :r AND unit_id = :u ORDER BY position"),
        {"r": release_id, "u": unit_id}).mappings().all()
    questions = conn.execute(text(
        "SELECT question_id, question_type_id, position, printed_number,"
        " prompt, slot_id, conversion_status FROM release_questions"
        " WHERE release_id = :r AND unit_id = :u ORDER BY position"),
        {"r": release_id, "u": unit_id}).mappings().all()
    q_payload = []
    for q in questions:
        options = conn.execute(text(
            "SELECT option_id, position, content FROM release_options"
            " WHERE release_id = :r AND question_id = :q ORDER BY position"),
            {"r": release_id, "q": q["question_id"]}).mappings().all()
        entry = {
            "id": q["question_id"],
            "question_type_id": q["question_type_id"],
            "position": q["position"],
            "printed_number": q["printed_number"],
            "prompt": q["prompt"],
            "slot_id": q["slot_id"],
            "conversion_status": q["conversion_status"],
            "options": [
                {"id": o["option_id"], "position": o["position"],
                 "content": o["content"]} for o in options
            ],
        }
        if include_private:
            key = conn.execute(text(
                "SELECT correct_option_id, revision, review_status"
                " FROM release_answer_keys"
                " WHERE release_id = :r AND question_id = :q"),
                {"r": release_id, "q": q["question_id"]}).mappings().first()
            entry["answer_key"] = dict(key) if key else None
        q_payload.append(entry)

    payload = {
        "release_id": str(release_id),
        "id": unit["unit_id"],
        "layer_id": unit["layer_id"],
        "question_type_id": unit["question_type_id"],
        "kind": unit["kind"],
        "position": unit["position"],
        "label": unit["label"],
        "slot_ids": unit["slot_ids"],
        "conversion_status": unit["conversion_status"],
        "materials": [
            {"id": m["material_id"], "kind": m["kind"], "role": m["role"],
             "language": m["language"], "content": m["content"],
             "asset_id": m["asset_id"],
             **({"cues": m["cues"]} if include_private else {})}
            for m in materials
        ],
        "questions": q_payload,
    }
    if include_private:
        explanations = conn.execute(text(
            "SELECT explanation_id, question_id, unit_id, kind, language,"
            " content, revision, review_status FROM release_explanations"
            " WHERE release_id = :r AND (unit_id = :u OR question_id IN ("
            "   SELECT question_id FROM release_questions"
            "   WHERE release_id = :r AND unit_id = :u))"),
            {"r": release_id, "u": unit_id}).mappings().all()
        payload["explanations"] = [dict(e) for e in explanations]
    return payload


@router.get("/api/exams")
def list_public_exams() -> list[dict]:
    """Published exams only; nothing internal leaks here."""
    with get_engine().connect() as conn:
        rows = conn.execute(text(
            "SELECT c.exam_id, r.id AS release_id, r.revision,"
            " e.level, e.year, e.month, e.title"
            " FROM exam_current_releases c"
            " JOIN exam_releases r ON r.id = c.release_id"
            " JOIN exam_catalogs e ON e.id = c.exam_id"
            " WHERE r.state = 'published' ORDER BY e.level, e.year, e.month"),
        ).mappings().all()
    return [dict(r) for r in rows]


@router.get("/api/exams/{exam_id}/units/{unit_id}")
def get_public_unit(exam_id: str, unit_id: str) -> dict:
    with get_engine().connect() as conn:
        release_id = _current_release_id(conn, exam_id)
        if release_id is None:
            raise HTTPException(status_code=404, detail="exam not published")
        unit = _load_unit_payload(conn, str(release_id), unit_id,
                                  include_private=False)
    if unit is None:
        raise HTTPException(status_code=404, detail="unit not found")
    if unit["conversion_status"] != "complete":
        raise HTTPException(status_code=404, detail="unit not available")
    return unit


@router.get("/internal/exams/{exam_id}/units/{unit_id}")
def get_internal_unit(exam_id: str, unit_id: str,
                      x_internal_token: str | None = Header(default=None)) -> dict:
    _require_internal_token(x_internal_token)
    with get_engine().connect() as conn:
        release_id = conn.execute(text(
            "SELECT id FROM exam_releases WHERE exam_id = :e"
            " ORDER BY revision DESC LIMIT 1"), {"e": exam_id}).scalar()
        if release_id is None:
            raise HTTPException(status_code=404, detail="exam has no release")
        unit = _load_unit_payload(conn, str(release_id), unit_id,
                                  include_private=True)
    if unit is None:
        raise HTTPException(status_code=404, detail="unit not found")
    return unit
