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
    """Published exams only; nothing internal leaks here.

    question_count = questions in the practiceable units of the release.
    """
    with get_engine().connect() as conn:
        rows = conn.execute(text(
            "SELECT c.exam_id, r.id AS release_id, r.revision,"
            " e.level, e.year, e.month, e.title,"
            # same visibility rule as the outline: questions of practiceable
            # (complete) units only, so the number matches what a student can do
            " (SELECT count(*) FROM release_questions q"
            "  JOIN release_units u ON u.release_id = q.release_id"
            "   AND u.unit_id = q.unit_id"
            "  WHERE q.release_id = r.id AND u.conversion_status = 'complete')"
            "   AS question_count"
            " FROM exam_current_releases c"
            " JOIN exam_releases r ON r.id = c.release_id"
            " JOIN exam_catalogs e ON e.id = c.exam_id"
            " WHERE r.state = 'published'"
            "   AND e.kind IN ('past_exam', 'mock_exam')"  # ADR-0030
            " ORDER BY e.level, e.year, e.month"),
        ).mappings().all()
    return [dict(r) for r in rows]


def _load_exam_outline(conn, exam_id: str, with_units: bool) -> dict:
    """Sections → layers (→ units) outline of the current published release.

    Serves GET /api/exams/{id} and GET /api/exams/{id}/layers. Public-safe:
    no answer keys, explanations, provenance or availability metadata.
    """
    head = conn.execute(text(
        "SELECT c.exam_id, r.id AS release_id, r.revision,"
        " e.level, e.year, e.month, e.title"
        " FROM exam_current_releases c"
        " JOIN exam_releases r ON r.id = c.release_id"
        " JOIN exam_catalogs e ON e.id = c.exam_id"
        " WHERE c.exam_id = :e AND r.state = 'published'"),
        {"e": exam_id}).mappings().first()
    if head is None:
        return None
    release_id = str(head["release_id"])
    outline = {
        "exam_id": head["exam_id"], "release_id": release_id,
        "revision": head["revision"], "level": head["level"],
        "year": head["year"], "month": head["month"], "title": head["title"],
        "sections": [],
    }
    sections = conn.execute(text(
        "SELECT section_id, subject, position, title FROM release_sections"
        " WHERE release_id = :r ORDER BY position"), {"r": release_id}).mappings().all()
    layers = conn.execute(text(
        "SELECT l.section_id, l.layer_id, l.question_type_id, l.position,"
        " l.display_label, l.instruction, qt.label_zh AS type_label_zh"
        " FROM release_layers l"
        " LEFT JOIN question_types qt ON qt.id = l.question_type_id"
        " WHERE l.release_id = :r ORDER BY l.section_id, l.position"),
        {"r": release_id}).mappings().all()
    units_by_layer: dict[str, list] = {}
    unit_rows = conn.execute(text(
        "SELECT u.layer_id, u.unit_id, u.position, u.kind, u.label,"
        " u.question_type_id,"
        " (SELECT count(*) FROM release_questions q"
        "  WHERE q.release_id = u.release_id AND q.unit_id = u.unit_id)"
        "   AS question_count"
        " FROM release_units u"
        " WHERE u.release_id = :r AND u.conversion_status = 'complete'"
        " ORDER BY u.layer_id, u.position"), {"r": release_id}).mappings().all()
    for u in unit_rows:
        entry = {"unit_id": u["unit_id"], "position": u["position"],
                 "kind": u["kind"], "label": u["label"],
                 "question_type_id": u["question_type_id"],
                 "question_count": u["question_count"]}
        units_by_layer.setdefault(u["layer_id"], []).append(entry)
    layers_by_section: dict[str, list] = {}
    for l in layers:
        entry = {
            "layer_id": l["layer_id"], "position": l["position"],
            "question_type_id": l["question_type_id"],
            "display_label": l["display_label"], "instruction": l["instruction"],
            "question_type_label": l["type_label_zh"],
        }
        if with_units:
            entry["units"] = units_by_layer.get(l["layer_id"], [])
        else:
            entry["unit_count"] = len(units_by_layer.get(l["layer_id"], []))
        layers_by_section.setdefault(l["section_id"], []).append(entry)
    for s in sections:
        outline["sections"].append({
            "section_id": s["section_id"], "subject": s["subject"],
            "position": s["position"], "title": s["title"],
            "layers": layers_by_section.get(s["section_id"], []),
        })
    return outline


@router.get("/api/exams/{exam_id}")
def get_public_exam(exam_id: str) -> dict:
    """Exam outline: sections → layers → practiceable units. No answers."""
    with get_engine().connect() as conn:
        outline = _load_exam_outline(conn, exam_id, with_units=True)
    if outline is None:
        raise HTTPException(status_code=404, detail="exam not published")
    return outline


@router.get("/api/exams/{exam_id}/layers")
def get_public_exam_layers(exam_id: str) -> dict:
    """Layer catalog of the current published release (unit counts only)."""
    with get_engine().connect() as conn:
        outline = _load_exam_outline(conn, exam_id, with_units=False)
    if outline is None:
        raise HTTPException(status_code=404, detail="exam not published")
    return outline


def _get_public_unit_payload(conn, release_id: str, unit_id: str) -> dict:
    unit = _load_unit_payload(conn, release_id, unit_id, include_private=False)
    if unit is None:
        raise HTTPException(status_code=404, detail="unit not found")
    if unit["conversion_status"] != "complete":
        raise HTTPException(status_code=404, detail="unit not available")
    return unit


@router.get("/api/exams/{exam_id}/units/{unit_id}")
def get_public_unit(exam_id: str, unit_id: str) -> dict:
    with get_engine().connect() as conn:
        release_id = _current_release_id(conn, exam_id)
        if release_id is None:
            raise HTTPException(status_code=404, detail="exam not published")
        unit = _get_public_unit_payload(conn, str(release_id), unit_id)
    return unit


@router.get("/api/releases/{release_id}/units/{unit_id}")
def get_public_unit_by_release(release_id: str, unit_id: str) -> dict:
    """Release-scoped unit fetch for in-progress sessions.

    Sessions bind a concrete release_id at start; later publishes must not
    change what an ongoing session reads. Only releases in state='published'
    are served — drafts stay behind the internal token boundary.
    """
    with get_engine().connect() as conn:
        state = conn.execute(text(
            "SELECT state FROM exam_releases WHERE id = :r"),
            {"r": release_id}).scalar()
        if state != "published":
            raise HTTPException(status_code=404, detail="release not published")
        unit = _get_public_unit_payload(conn, str(release_id), unit_id)
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
