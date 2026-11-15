"""Publisher + API tests: snapshot creation, idempotency, gates, leak checks.

Runs against the isolated test database (see conftest.py).
"""
import json

import pytest

from conftest import CLOZE_UNIT, EXAM_ID, PACKAGE_ID

requires_db = pytest.mark.skipif(
    not __import__("os").environ.get("DATABASE_URL"),
    reason="DATABASE_URL not set; requires migrated PostgreSQL",
)


# fixtures: clean_publish / staged_and_published come from conftest.py


# ------------------------------------------------------------- publisher ----

@requires_db
def test_publish_creates_draft_snapshot(pg_engine, staged_and_published, clean_publish):
    from sqlalchemy import text
    result = staged_and_published
    assert result["state"] == "draft" and not result["idempotent"]

    with pg_engine.connect() as conn:
        release = conn.execute(text(
            "SELECT exam_id, revision, state, content_hash FROM exam_releases"
            " WHERE id = :r"), {"r": result["release_id"]}).one()
        assert release.state == "draft" and release.revision == 1
        assert release.exam_id == EXAM_ID

        counts = {
            t: conn.execute(text(
                f"SELECT count(*) FROM {t} WHERE release_id = :r"),
                {"r": result["release_id"]}).scalar()
            for t in ("release_sections", "release_layers", "release_units",
                      "release_unit_materials", "release_questions",
                      "release_options", "release_answer_keys",
                      "release_explanations")
        }
        registries = {
            "exam_catalogs": conn.execute(text(
                "SELECT count(*) FROM exam_catalogs WHERE id = :e"), {"e": EXAM_ID}).scalar(),
            "question_registry": conn.execute(text(
                "SELECT count(*) FROM question_registry WHERE exam_id = :e"), {"e": EXAM_ID}).scalar(),
            "media_assets": conn.execute(text(
                "SELECT count(*) FROM media_assets WHERE id = 'JLPTGO-N5-TEST-EX-as001'")).scalar(),
            "decisions": conn.execute(text(
                "SELECT count(*) FROM publication_decisions WHERE exam_id = :e"), {"e": EXAM_ID}).scalar(),
            "current_pointer": conn.execute(text(
                "SELECT count(*) FROM exam_current_releases WHERE exam_id = :e"), {"e": EXAM_ID}).scalar(),
        }

    assert counts == {
        "release_sections": 2, "release_layers": 2, "release_units": 2,
        "release_unit_materials": 1, "release_questions": 3,
        "release_options": 9, "release_answer_keys": 3, "release_explanations": 1,
    }
    assert registries == {"exam_catalogs": 1, "question_registry": 3,
                          "media_assets": 1, "decisions": 1, "current_pointer": 0}


@requires_db
def test_publish_is_idempotent(pg_engine, staged_and_published):
    from app.publisher import publish_package
    result2 = publish_package(pg_engine, PACKAGE_ID)
    assert result2["idempotent"] is True
    assert result2["release_id"] == staged_and_published["release_id"]


@requires_db
def test_promote_refuses_unreviewed_content(pg_engine, staged_and_published):
    from app.publisher import PublishGateError, promote_release
    with pytest.raises(PublishGateError, match="human_reviewed"):
        promote_release(pg_engine, staged_and_published["release_id"],
                        reviewer_id="tester")
    from sqlalchemy import text
    with pg_engine.connect() as conn:
        state = conn.execute(text(
            "SELECT state FROM exam_releases WHERE id = :r"),
            {"r": staged_and_published["release_id"]}).scalar()
        pointer = conn.execute(text(
            "SELECT count(*) FROM exam_current_releases WHERE exam_id = :e"),
            {"e": EXAM_ID}).scalar()
    assert state == "draft" and pointer == 0


@requires_db
def test_promote_publishes_after_review_and_sets_pointer(
        pg_engine, staged_and_published):
    from sqlalchemy import text
    from app.publisher import confirm_rights, promote_release
    with pg_engine.begin() as conn:
        conn.execute(text(
            "UPDATE release_answer_keys SET review_status = 'human_reviewed'"
            " WHERE release_id = :r"), {"r": staged_and_published["release_id"]})
        conn.execute(text(
            "UPDATE media_assets SET availability = 'verified'"
            " WHERE id = 'JLPTGO-N5-TEST-EX-as001'"))
    confirm_rights(pg_engine, EXAM_ID, reviewer_id="legal")
    result = promote_release(pg_engine, staged_and_published["release_id"],
                             reviewer_id="reviewer-1", notes="test approval")
    assert result["state"] == "published"
    with pg_engine.connect() as conn:
        pointer = conn.execute(text(
            "SELECT release_id FROM exam_current_releases WHERE exam_id = :e"),
            {"e": EXAM_ID}).scalar()
        decisions = conn.execute(text(
            "SELECT decision FROM publication_decisions WHERE exam_id = :e"
            " ORDER BY decided_at"), {"e": EXAM_ID}).scalars().all()
    assert str(pointer) == staged_and_published["release_id"]
    assert decisions == ["snapshot_draft_created", "rights_confirmed", "approved"]


@requires_db
def test_promote_requires_independent_rights_confirmation(
        pg_engine, staged_and_published):
    from sqlalchemy import text
    from app.publisher import PublishGateError, confirm_rights, promote_release
    with pg_engine.begin() as conn:
        conn.execute(text(
            "UPDATE release_answer_keys SET review_status = 'human_reviewed'"
            " WHERE release_id = :r"), {"r": staged_and_published["release_id"]})
        conn.execute(text(
            "UPDATE media_assets SET availability = 'verified'"
            " WHERE id = 'JLPTGO-N5-TEST-EX-as001'"))
    with pytest.raises(PublishGateError, match="rights_confirmed"):
        promote_release(pg_engine, staged_and_published["release_id"],
                        reviewer_id="reviewer-1")
    confirm_rights(pg_engine, EXAM_ID, reviewer_id="legal", notes="license ok")
    result = promote_release(pg_engine, staged_and_published["release_id"],
                             reviewer_id="reviewer-1")
    assert result["state"] == "published"


# ------------------------------------------------------------------- API ----

@requires_db
def test_public_api_hides_draft_and_never_leaks_answers(
        pg_engine, staged_and_published, monkeypatch):
    # Point the app at the isolated test DB for the duration of this test.
    monkeypatch.setenv("DATABASE_URL",
                       pg_engine.url.render_as_string(hide_password=False))
    from fastapi.testclient import TestClient
    from app.main import app
    client = TestClient(app)

    # Draft release: public surface shows nothing.
    assert client.get("/api/exams").json() == []
    resp = client.get(f"/api/exams/{EXAM_ID}/units/{CLOZE_UNIT}")
    assert resp.status_code == 404

    # Internal API requires a token.
    monkeypatch.delenv("INTERNAL_API_TOKEN", raising=False)
    assert client.get(f"/internal/exams/{EXAM_ID}/units/{CLOZE_UNIT}").status_code == 403
    monkeypatch.setenv("INTERNAL_API_TOKEN", "secret-token")
    assert client.get(
        f"/internal/exams/{EXAM_ID}/units/{CLOZE_UNIT}",
        headers={"X-Internal-Token": "wrong"}).status_code == 401

    resp = client.get(f"/internal/exams/{EXAM_ID}/units/{CLOZE_UNIT}",
                      headers={"X-Internal-Token": "secret-token"})
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["kind"] == "cloze"
    assert len(payload["slot_ids"]) == 2
    assert len(payload["questions"]) == 2
    assert all(q["answer_key"] is not None for q in payload["questions"])
    assert payload["explanations"]

    # Promote for real, then public must expose content but NOT answers.
    from sqlalchemy import text
    from app.publisher import confirm_rights, promote_release
    with pg_engine.begin() as conn:
        conn.execute(text(
            "UPDATE release_answer_keys SET review_status = 'human_reviewed'"
            " WHERE release_id = :r"), {"r": staged_and_published["release_id"]})
        conn.execute(text(
            "UPDATE media_assets SET availability = 'verified'"
            " WHERE id = 'JLPTGO-N5-TEST-EX-as001'"))
    confirm_rights(pg_engine, EXAM_ID, reviewer_id="legal")
    promote_release(pg_engine, staged_and_published["release_id"],
                    reviewer_id="reviewer-1")

    exams = client.get("/api/exams").json()
    assert [e["exam_id"] for e in exams] == [EXAM_ID]
    public_unit = client.get(f"/api/exams/{EXAM_ID}/units/{CLOZE_UNIT}").json()
    assert len(public_unit["questions"]) == 2
    flat = json.dumps(public_unit, ensure_ascii=False)
    assert "answer_key" not in public_unit["questions"][0]
    assert "correct_option_id" not in flat
    assert "review_status" not in flat
    assert "explanations" not in public_unit
