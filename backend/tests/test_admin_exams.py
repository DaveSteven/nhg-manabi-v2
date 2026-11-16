"""Admin exam/release management: list, withdraw (下架), restore (上架).

Withdraw must close EVERY public exit (catalog, outline, release unit, media,
new sessions) and be reversible; every action needs an admin session and is
attributed to the admin server-side. Real PG, isolated test DB.
"""
import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from conftest import CLOZE_UNIT, EXAM_ID, SINGLE_UNIT
from test_practice_sessions import requires_db

PW = "correct horse battery"


@pytest.fixture(autouse=True)
def clean_admin(pg_engine):
    def wipe():
        with pg_engine.begin() as conn:
            conn.execute(text("DELETE FROM admin_sessions"))
            conn.execute(text("DELETE FROM admin_users"))
    wipe()
    yield
    wipe()


@pytest.fixture()
def client(monkeypatch, pg_engine):
    monkeypatch.setenv("DATABASE_URL", pg_engine.url.render_as_string(hide_password=False))
    monkeypatch.setenv("AUTH_MODE", "dev_test")
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("DEV_TEST_USER_IDS", "11111111-1111-4111-8111-111111111111")
    from app.main import app
    return TestClient(app)


def _admin_headers(client, pg_engine, username="boss"):
    from app.admin_auth import create_admin
    create_admin(pg_engine, username, PW, "super_admin", display_name="Boss")
    tok = client.post("/api/admin/auth/login",
                      json={"username": username, "password": PW}).json()["token"]
    return {"Authorization": f"Bearer {tok}"}


STUDENT = {"Authorization": "Bearer 11111111-1111-4111-8111-111111111111"}


# ------------------------------------------------------------------- auth ----

@requires_db
def test_every_admin_exam_endpoint_requires_an_admin_session(client, published_release):
    rid = str(published_release)
    for method, path in (("GET", "/api/admin/exams"),
                         ("GET", f"/api/admin/exams/{EXAM_ID}/releases"),
                         ("POST", f"/api/admin/releases/{rid}/withdraw"),
                         ("POST", f"/api/admin/releases/{rid}/restore")):
        assert client.request(method, path).status_code == 401, path
        assert client.request(method, path, headers=STUDENT).status_code == 401, path


# ------------------------------------------------------------------- list ----

@requires_db
def test_list_reports_status_counts_and_auto_publish_note(client, pg_engine, published_release):
    h = _admin_headers(client, pg_engine)
    rows = client.get("/api/admin/exams", headers=h).json()["exams"]
    row = next(r for r in rows if r["exam_id"] == EXAM_ID)
    assert row["status"] == "published" and row["level"] == "N5"
    assert row["release"]["id"] == str(published_release) and row["release"]["state"] == "published"
    assert row["counts"]["units"] == 2 and row["counts"]["hidden_units"] == 0
    assert row["counts"]["questions"] == 3
    assert row["counts"]["unverified_answer_keys"] == 0     # fixture keys were human_reviewed

    # An auto-published exam surfaces its recorded "what was not verified" note.
    with pg_engine.begin() as conn:
        conn.execute(text(
            "INSERT INTO publication_decisions (id, exam_id, candidate_content_hash,"
            " decision, reviewer_id, notes) VALUES (gen_random_uuid(), :e, 'h',"
            " 'auto_published', 'system:auto-publish', :n)"),
            {"e": EXAM_ID, "n": json.dumps({"policy": "auto", "unverified_answer_keys": 7})})
    row = next(r for r in client.get("/api/admin/exams", headers=h).json()["exams"]
               if r["exam_id"] == EXAM_ID)
    assert row["publication"]["decision"] == "auto_published"
    assert row["publication"]["note"]["unverified_answer_keys"] == 7


@requires_db
def test_hidden_units_are_counted(client, pg_engine, published_release):
    with pg_engine.begin() as conn:
        conn.execute(text("UPDATE release_units SET conversion_status = 'needs_review'"
                          " WHERE release_id = :r AND unit_id = :u"),
                     {"r": published_release, "u": SINGLE_UNIT})
    h = _admin_headers(client, pg_engine)
    row = next(r for r in client.get("/api/admin/exams", headers=h).json()["exams"]
               if r["exam_id"] == EXAM_ID)
    assert row["counts"]["hidden_units"] == 1 and row["counts"]["units"] == 2


# --------------------------------------------------------------- withdraw ----

@requires_db
def test_withdraw_closes_every_public_exit_and_is_attributed(client, pg_engine, published_release):
    rid = str(published_release)
    assert client.get("/api/exams").status_code == 200
    assert any(e["exam_id"] == EXAM_ID for e in client.get("/api/exams").json())
    h = _admin_headers(client, pg_engine)

    r = client.post(f"/api/admin/releases/{rid}/withdraw", headers=h,
                    json={"reason": "wrong answer key reported"})
    assert r.status_code == 200 and r.json()["state"] == "withdrawn"

    assert all(e["exam_id"] != EXAM_ID for e in client.get("/api/exams").json())
    assert client.get(f"/api/exams/{EXAM_ID}").status_code == 404
    assert client.get(f"/api/releases/{rid}/units/{CLOZE_UNIT}").status_code == 404
    assert client.get(f"/api/exams/{EXAM_ID}/units/{CLOZE_UNIT}").status_code == 404
    sess = client.post("/api/practice/sessions", headers=STUDENT, json={
        "feedback_mode": "immediate",
        "units": [{"release_id": rid, "unit_id": CLOZE_UNIT}]})
    assert sess.status_code in (404, 422)

    with pg_engine.connect() as conn:
        dec = conn.execute(text(
            "SELECT decision, reviewer_id, notes FROM publication_decisions"
            " WHERE exam_id=:e AND decision='withdrawn'"), {"e": EXAM_ID}).first()
        admin_id = conn.execute(text("SELECT id FROM admin_users WHERE username='boss'")).scalar()
        cur = conn.execute(text("SELECT count(*) FROM exam_current_releases WHERE exam_id=:e"),
                           {"e": EXAM_ID}).scalar()
    assert dec.reviewer_id == f"admin:{admin_id}" and "wrong answer key" in dec.notes
    assert cur == 0
    row = next(x for x in client.get("/api/admin/exams", headers=h).json()["exams"]
               if x["exam_id"] == EXAM_ID)
    assert row["status"] == "withdrawn" and row["release"]["state"] == "withdrawn"


@requires_db
def test_withdraw_conflicts_and_unknowns(client, pg_engine, published_release):
    h = _admin_headers(client, pg_engine)
    rid = str(published_release)
    assert client.post(f"/api/admin/releases/{rid}/withdraw", headers=h, json={}).status_code == 200
    again = client.post(f"/api/admin/releases/{rid}/withdraw", headers=h, json={})
    assert again.status_code == 409 and again.json()["detail"]["code"] == "not_published"
    assert client.post("/api/admin/releases/00000000-0000-4000-8000-000000000000/withdraw",
                       headers=h, json={}).status_code == 404
    assert client.post("/api/admin/releases/not-a-uuid/withdraw", headers=h,
                       json={}).status_code == 422


# ---------------------------------------------------------------- restore ----

@requires_db
def test_restore_reopens_the_exam_and_requires_withdrawn_state(client, pg_engine, published_release):
    h = _admin_headers(client, pg_engine)
    rid = str(published_release)
    not_withdrawn = client.post(f"/api/admin/releases/{rid}/restore", headers=h)
    assert not_withdrawn.status_code == 409
    assert not_withdrawn.json()["detail"]["code"] == "not_withdrawn"

    client.post(f"/api/admin/releases/{rid}/withdraw", headers=h, json={})
    r = client.post(f"/api/admin/releases/{rid}/restore", headers=h)
    assert r.status_code == 200 and r.json()["state"] == "published"
    assert client.get(f"/api/exams/{EXAM_ID}").status_code == 200
    assert client.get(f"/api/releases/{rid}/units/{CLOZE_UNIT}").status_code == 200
    with pg_engine.connect() as conn:
        decisions = conn.execute(text(
            "SELECT decision FROM publication_decisions WHERE exam_id=:e"
            " AND decision IN ('withdrawn','restored') ORDER BY decided_at"),
            {"e": EXAM_ID}).scalars().all()
    assert decisions == ["withdrawn", "restored"], "history is kept, never overwritten"


@requires_db
def test_restore_does_not_displace_a_newer_current_release(client, pg_engine, published_release):
    """Restoring an old release must not steal the current pointer if the
    exam already has a (newer) published release."""
    from app.publisher import auto_publish_package  # noqa: F401 (import check)
    h = _admin_headers(client, pg_engine)
    rid = str(published_release)
    client.post(f"/api/admin/releases/{rid}/withdraw", headers=h, json={})
    with pg_engine.begin() as conn:      # simulate a newer release already current
        newer = conn.execute(text(
            "INSERT INTO exam_releases (id, exam_id, revision, content_hash, schema_version,"
            " state, published_at) VALUES (gen_random_uuid(), :e, 99, :h, '2.0.0',"
            " 'published', now()) RETURNING id"),
            {"e": EXAM_ID, "h": "f" * 64}).scalar()
        conn.execute(text("INSERT INTO exam_current_releases (exam_id, release_id)"
                          " VALUES (:e, :r)"), {"e": EXAM_ID, "r": newer})
    r = client.post(f"/api/admin/releases/{rid}/restore", headers=h)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "exam_has_current_release"
    with pg_engine.begin() as conn:      # cleanup for clean_publish
        conn.execute(text("DELETE FROM exam_current_releases WHERE exam_id=:e"), {"e": EXAM_ID})
        conn.execute(text("DELETE FROM exam_releases WHERE id=:r"), {"r": newer})


@requires_db
def test_releases_listing_for_an_exam(client, pg_engine, published_release):
    h = _admin_headers(client, pg_engine)
    out = client.get(f"/api/admin/exams/{EXAM_ID}/releases", headers=h).json()["releases"]
    assert [r["id"] for r in out] == [str(published_release)]
    assert out[0]["state"] == "published" and out[0]["is_current"] is True
    assert client.get("/api/admin/exams/NOPE/releases", headers=h).status_code == 404
