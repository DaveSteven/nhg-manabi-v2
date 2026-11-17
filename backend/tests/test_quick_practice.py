"""Quick Practice tests (audio/quick-practice spec §5.4, §10).

replace_active must atomically end the active practice (ended_early,
submitted answers kept) and create the new session in ONE transaction;
double-fire must never yield two in-progress sessions. practice-status
returns the caller's own per-unit submission history for an exam.
"""
import os

import pytest
import sqlalchemy as sa

from conftest import CLOZE_UNIT, SINGLE_UNIT

requires_db = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"),
    reason="DATABASE_URL not set; requires migrated PostgreSQL",
)

USER_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
USER_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
Q1 = f"{CLOZE_UNIT}-q01"  # correct: -o2
Q2 = f"{CLOZE_UNIT}-q02"  # correct: -o1
Q3 = f"{SINGLE_UNIT}-q01"  # correct: -o3


@pytest.fixture(autouse=True)
def _study_isolation(clean_study):
    """Wipe the study domain around each test (shared conftest fixture)."""


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


def create(client, user_id, release_id, unit_ids, feedback="immediate",
           replace_active=False):
    return client.post(
        "/api/practice/sessions", json={
            "feedback_mode": feedback,
            "units": [{"release_id": str(release_id), "unit_id": u}
                      for u in unit_ids],
            "replace_active": replace_active,
        }, headers=auth(user_id))


def unit_id_map(session: dict) -> dict:
    return {u["unit_id"]: u["id"] for u in session["units"]}


def submit(client, user, sid, suid, answers):
    return client.post(
        f"/api/practice/sessions/{sid}/units/{suid}/submit",
        json={"answers": [{"question_id": q, "chosen_option_id": c}
                          for q, c in answers]},
        headers=auth(user))


@requires_db
def test_replace_active_atomic_end_and_create(pg_engine, published_release,
                                              monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    old = create(client, USER_A, published_release, [CLOZE_UNIT]).json()
    old_suid = unit_id_map(old)[CLOZE_UNIT]
    submit(client, USER_A, old["id"], old_suid,
           [(Q1, Q1 + "-o2"), (Q2, Q2 + "-o1")])  # formally submitted

    resp = create(client, USER_A, published_release, [SINGLE_UNIT],
                  replace_active=True)
    assert resp.status_code == 201
    new = resp.json()

    with pg_engine.connect() as conn:
        states = dict(conn.execute(sa.text(
            "SELECT id::text, state FROM study_sessions WHERE user_id = :u"),
            {"u": USER_A}).all())
    assert states[old["id"]] == "ended_early"  # old ended, not deleted
    assert states[new["id"]] == "in_progress"
    # submitted answers of the old session are kept (not scored into a result)
    conn = pg_engine.connect()
    kept = conn.execute(sa.text(
        "SELECT count(*) FROM study_submitted_answers sa"
        " JOIN study_session_units su ON su.id = sa.session_unit_id"
        " WHERE su.session_id = :s"), {"s": old["id"]}).scalar()
    conn.close()
    assert kept == 2
    assert client.get(
        f"/api/practice/sessions/{old['id']}/results",
        headers=auth(USER_A)).status_code == 409  # ended_early: no score


@requires_db
def test_replace_active_without_active_is_plain_create(
        pg_engine, published_release, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    resp = create(client, USER_A, published_release, [SINGLE_UNIT],
                  replace_active=True)
    assert resp.status_code == 201


@requires_db
def test_replace_active_double_fire_never_two_active(
        pg_engine, published_release, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    first = create(client, USER_A, published_release, [CLOZE_UNIT],
                   replace_active=True)
    assert first.status_code == 201
    second = create(client, USER_A, published_release, [SINGLE_UNIT],
                    replace_active=True)
    assert second.status_code == 201
    third = create(client, USER_A, published_release, [SINGLE_UNIT],
                   replace_active=True)
    assert third.status_code == 201
    with pg_engine.connect() as conn:
        active = conn.execute(sa.text(
            "SELECT count(*) FROM study_sessions"
            " WHERE user_id = :u AND state = 'in_progress'"),
            {"u": USER_A}).scalar()
    assert active == 1


@requires_db
def test_replace_false_still_409(pg_engine, published_release, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    create(client, USER_A, published_release, [CLOZE_UNIT])
    r = create(client, USER_A, published_release, [SINGLE_UNIT])
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "active_session_exists"


@requires_db
def test_practice_status_own_history_only(pg_engine, published_release,
                                          monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    s1 = create(client, USER_A, published_release, [CLOZE_UNIT]).json()
    suid = unit_id_map(s1)[CLOZE_UNIT]
    submit(client, USER_A, s1["id"], suid,
           [(Q1, Q1 + "-o2"), (Q2, Q2 + "-o1")])
    s2 = create(client, USER_A, published_release, [SINGLE_UNIT],
                replace_active=True).json()
    suid2 = unit_id_map(s2)[SINGLE_UNIT]
    # USER_B submits nothing; USER_A has CLOZE done, SINGLE pending

    r = client.get(f"/api/exams/{s1['units'][0]['exam_id']}/practice-status",
                   headers=auth(USER_A))
    assert r.status_code == 200
    units = {u["unit_id"]: u for u in r.json()["units"]}
    assert units[CLOZE_UNIT]["submitted_count"] == 1
    assert units[CLOZE_UNIT]["last_submitted_at"] is not None
    assert SINGLE_UNIT not in units

    # another user sees nothing of USER_A's history
    r2 = client.get(f"/api/exams/{s1['units'][0]['exam_id']}/practice-status",
                    headers=auth(USER_B))
    assert r2.status_code == 200
    assert r2.json()["units"] == []
