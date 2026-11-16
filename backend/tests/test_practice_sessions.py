"""M2 Task 04 tests: practice session lifecycle.

Covers: creation with pinned release binding, the one-active-practice rule
(409 with the conflicting session id), resume, ownership isolation, finish
(ended_early, idempotent, no fabricated score), and rejection of draft /
non-current content.
"""
import os
import uuid as uuid_mod

import pytest

from conftest import CLOZE_UNIT, EXAM_ID, SINGLE_UNIT

requires_db = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"),
    reason="DATABASE_URL not set; requires migrated PostgreSQL",
)

USER_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
USER_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"


def make_client(monkeypatch, pg_engine):
    monkeypatch.setenv(
        "DATABASE_URL", pg_engine.url.render_as_string(hide_password=False))
    monkeypatch.setenv("AUTH_MODE", "dev_test")
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("DEV_TEST_USER_IDS", f"{USER_A},{USER_B}")
    from fastapi.testclient import TestClient
    from app.main import app
    return TestClient(app)


def auth(user_id: str) -> dict:
    return {"Authorization": f"Bearer {user_id}"}


@pytest.fixture(autouse=True)
def _study_isolation(clean_study):
    """Wipe the study domain around each test (shared conftest fixture)."""


def create_session(client, user_id, release_id, unit_ids, feedback="immediate"):
    return client.post(
        "/api/practice/sessions", json={
            "feedback_mode": feedback,
            "units": [{"release_id": str(release_id), "unit_id": u}
                      for u in unit_ids],
        }, headers=auth(user_id))


@requires_db
def test_create_session_pins_release_and_orders_units(
        pg_engine, published_release, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    resp = create_session(client, USER_A, published_release,
                          [CLOZE_UNIT, SINGLE_UNIT])
    assert resp.status_code == 201, resp.text
    session = resp.json()
    assert session["mode"] == "practice"
    assert session["state"] == "in_progress"
    assert session["feedback_mode"] == "immediate"
    assert session["ended_at"] is None
    assert [u["position"] for u in session["units"]] == [1, 2]
    assert [u["unit_id"] for u in session["units"]] == [CLOZE_UNIT, SINGLE_UNIT]
    # Every session unit is bound to the concrete release_id (cross-exam
    # random practice later relies on this).
    assert all(u["release_id"] == published_release
               for u in session["units"])
    assert [m["unit_id"] for m in session["units_meta"]] == [
        CLOZE_UNIT, SINGLE_UNIT]
    assert session["units_meta"][0]["question_count"] == 2


@requires_db
def test_single_unit_session(pg_engine, published_release, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    resp = create_session(client, USER_A, published_release, [SINGLE_UNIT])
    assert resp.status_code == 201
    assert len(resp.json()["units"]) == 1


@requires_db
def test_one_active_practice_conflict(pg_engine, published_release,
                                      monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    first = create_session(client, USER_A, published_release, [CLOZE_UNIT])
    assert first.status_code == 201
    second = create_session(client, USER_A, published_release, [SINGLE_UNIT])
    assert second.status_code == 409
    detail = second.json()["detail"]
    assert detail["code"] == "active_session_exists"
    assert detail["active_session_id"] == first.json()["id"]
    # A different user is NOT blocked by user A's active session.
    assert create_session(
        client, USER_B, published_release, [SINGLE_UNIT]).status_code == 201


@requires_db
def test_resume_current_and_by_id(pg_engine, published_release, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    created = create_session(client, USER_A, published_release,
                             [CLOZE_UNIT, SINGLE_UNIT]).json()
    current = client.get("/api/practice/sessions/current",
                         headers=auth(USER_A))
    assert current.status_code == 200
    assert current.json()["id"] == created["id"]
    assert len(current.json()["units"]) == 2

    by_id = client.get(f"/api/practice/sessions/{created['id']}",
                       headers=auth(USER_A))
    assert by_id.status_code == 200
    assert by_id.json()["units"] == created["units"]


@requires_db
def test_cross_account_access_isolated(pg_engine, published_release,
                                       monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    created = create_session(client, USER_A, published_release,
                             [CLOZE_UNIT]).json()
    # B cannot read or finish A's session; response is 404 either way so
    # session existence never leaks across accounts.
    assert client.get(f"/api/practice/sessions/{created['id']}",
                      headers=auth(USER_B)).status_code == 404
    assert client.post(f"/api/practice/sessions/{created['id']}/finish",
                       headers=auth(USER_B)).status_code == 404
    assert client.get("/api/practice/sessions/current",
                      headers=auth(USER_B)).status_code == 404


@requires_db
def test_finish_ends_early_idempotent_and_frees_slot(
        pg_engine, published_release, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    created = create_session(client, USER_A, published_release,
                             [CLOZE_UNIT, SINGLE_UNIT]).json()
    fin = client.post(f"/api/practice/sessions/{created['id']}/finish",
                      headers=auth(USER_A))
    assert fin.status_code == 200
    body = fin.json()
    assert body["state"] == "ended_early"
    assert body["ended_at"] is not None
    assert body["idempotent"] is False
    # No result was fabricated: no study_results row exists.
    import sqlalchemy as sa
    with pg_engine.connect() as conn:
        n = conn.execute(sa.text(
            "SELECT count(*) FROM study_results WHERE session_id = :s"),
            {"s": created["id"]}).scalar()
    assert n == 0

    refin = client.post(f"/api/practice/sessions/{created['id']}/finish",
                        headers=auth(USER_A))
    assert refin.status_code == 200
    assert refin.json()["idempotent"] is True

    # Ending the old session frees the single active slot.
    nxt = create_session(client, USER_A, published_release, [SINGLE_UNIT])
    assert nxt.status_code == 201


@requires_db
def test_rejects_draft_and_unknown_units(pg_engine, staged_and_published,
                                         monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    draft_id = staged_and_published["release_id"]
    resp = create_session(client, USER_A, draft_id, [CLOZE_UNIT])
    assert resp.status_code == 422
    assert resp.json()["detail"]["code"] == "unit_not_available"

    resp = create_session(client, USER_A, str(uuid_mod.uuid4()),
                          [CLOZE_UNIT])
    assert resp.status_code == 422


@requires_db
def test_rejects_empty_and_duplicate_units(pg_engine, published_release,
                                           monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    assert client.post("/api/practice/sessions", json={
        "feedback_mode": "immediate", "units": []},
        headers=auth(USER_A)).status_code == 422
    dup = [{"release_id": str(published_release), "unit_id": CLOZE_UNIT}] * 2
    assert client.post("/api/practice/sessions", json={
        "feedback_mode": "immediate", "units": dup},
        headers=auth(USER_A)).status_code == 422
    assert client.post("/api/practice/sessions", json={
        "feedback_mode": "instant",
        "units": [{"release_id": str(published_release),
                   "unit_id": CLOZE_UNIT}]},
        headers=auth(USER_A)).status_code == 422
