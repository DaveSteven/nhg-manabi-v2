"""Quick Practice tests (audio/quick-practice spec §5.4, §10).

Quick sessions are their own mode and never touch practice sessions
(ADR-0015: practice sessions may be many). practice-status returns the
caller's own per-unit submission history for an exam.
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


def create(client, user_id, release_id, unit_ids, feedback="immediate"):
    return client.post(
        "/api/practice/sessions", json={
            "feedback_mode": feedback,
            "units": [{"release_id": str(release_id), "unit_id": u}
                      for u in unit_ids],
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
def test_practice_status_own_history_only(pg_engine, published_release,
                                          monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    s1 = create(client, USER_A, published_release, [CLOZE_UNIT]).json()
    suid = unit_id_map(s1)[CLOZE_UNIT]
    submit(client, USER_A, s1["id"], suid,
           [(Q1, Q1 + "-o2"), (Q2, Q2 + "-o1")])
    s2 = create(client, USER_A, published_release, [SINGLE_UNIT]).json()
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


# ------------------------------------------------ quick practice v2.0 ----

def create_quick(client, user_id, release_id, unit_id):
    return client.post(
        "/api/quick-practice/sessions",
        json={"release_id": str(release_id), "unit_id": unit_id},
        headers=auth(user_id))


@requires_db
def test_quick_session_created_in_dedicated_mode(pg_engine, published_release,
                                                 monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    r = create_quick(client, USER_A, published_release, CLOZE_UNIT)
    assert r.status_code == 201
    body = r.json()
    assert body["mode"] == "quick_practice"
    assert body["feedback_mode"] == "immediate"
    assert body["state"] == "in_progress"
    assert [u["unit_id"] for u in body["units"]] == [CLOZE_UNIT]


@requires_db
def test_quick_never_touches_active_practice_session(
        pg_engine, published_release, monkeypatch):
    """The core isolation rule: an in-progress 专项 practice session stays
    in_progress when a quick session starts — no 409, no silent end."""
    client = make_client(monkeypatch, pg_engine)
    practice = create(client, USER_A, published_release, [CLOZE_UNIT]).json()
    assert practice["state"] == "in_progress"

    r = create_quick(client, USER_A, published_release, SINGLE_UNIT)
    assert r.status_code == 201
    quick = r.json()

    with pg_engine.connect() as conn:
        states = {row[0]: (row[1], row[2]) for row in conn.execute(sa.text(
            "SELECT id::text, state, mode FROM study_sessions"
            " WHERE user_id = :u"), {"u": USER_A}).all()}
    assert states[practice["id"]] == ("in_progress", "practice")
    assert states[quick["id"]] == ("in_progress", "quick_practice")
    # starting another 专项 practice neither conflicts nor ends either one
    r2 = create(client, USER_A, published_release, [SINGLE_UNIT])
    assert r2.status_code == 201
    with pg_engine.connect() as conn:
        n = conn.execute(sa.text(
            "SELECT count(*) FROM study_sessions"
            " WHERE user_id = :u AND state = 'in_progress'"),
            {"u": USER_A}).scalar()
    assert n == 3


@requires_db
def test_quick_silently_replaces_previous_quick_session(
        pg_engine, published_release, monkeypatch):
    """Clicking another unit replaces a stale quick session WITHOUT any
    conflict dialog round-trip (unsubmitted quick selections reset by
    design); only ONE in-progress quick session may exist."""
    client = make_client(monkeypatch, pg_engine)
    first = create_quick(client, USER_A, published_release, CLOZE_UNIT).json()
    second = create_quick(client, USER_A, published_release, SINGLE_UNIT)
    assert second.status_code == 201
    second = second.json()

    with pg_engine.connect() as conn:
        rows = conn.execute(sa.text(
            "SELECT id::text, state FROM study_sessions"
            " WHERE user_id = :u AND mode = 'quick_practice'"),
            {"u": USER_A}).all()
    states = dict(rows)
    assert states[first["id"]] == "ended_early"
    assert states[second["id"]] == "in_progress"
    assert len(rows) == 2
    # the replaced quick session had no submissions: nothing was scored
    with pg_engine.connect() as conn:
        submitted = conn.execute(sa.text(
            "SELECT count(*) FROM study_submitted_answers"
            " WHERE session_unit_id IN"
            "   (SELECT id FROM study_session_units WHERE session_id = :s)"),
            {"s": first["id"]}).scalar()
    assert submitted == 0


@requires_db
def test_quick_submit_auto_completes_session_with_results(
        pg_engine, published_release, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    s = create_quick(client, USER_A, published_release, CLOZE_UNIT).json()
    suid = unit_id_map(s)[CLOZE_UNIT]
    r = submit(client, USER_A, s["id"], suid,
               [(Q1, Q1 + "-o2"), (Q2, Q2 + "-o3")])  # Q2: valid but wrong
    assert r.status_code == 200
    body = r.json()
    assert body["session_state"] == "completed"
    # immediate feedback with keys is served right in the submit response
    assert body["feedback"]["feedback_mode"] == "immediate"
    fq = {q["question_id"]: q for q in body["feedback"]["questions"]}
    assert fq[Q1]["is_correct"] is True
    assert fq[Q2]["is_correct"] is False

    with pg_engine.connect() as conn:
        state, = conn.execute(sa.text(
            "SELECT state FROM study_sessions WHERE id = :s"),
            {"s": s["id"]}).first()
        results = conn.execute(sa.text(
            "SELECT correct_count, wrong_count, skipped_count, total_count"
            " FROM study_results WHERE session_id = :s"),
            {"s": s["id"]}).all()
    assert state == "completed"
    assert results == [(1, 1, 0, 2)]
    # explicit finish is idempotent afterwards
    fin = client.post(f"/api/practice/sessions/{s['id']}/finish",
                      headers=auth(USER_A))
    assert fin.status_code == 200
    assert fin.json()["idempotent"] is True


@requires_db
def test_quick_practice_counts_once_and_survives_duplicate(
        pg_engine, published_release, monkeypatch):
    """One submitted quick session-unit = one practice; a duplicate submit
    (or an unanswered submit) never inflates the count; 专项 practice of
    the same unit adds a second, independent count."""
    client = make_client(monkeypatch, pg_engine)
    s = create_quick(client, USER_A, published_release, CLOZE_UNIT).json()
    suid = unit_id_map(s)[CLOZE_UNIT]
    exam_id = s["units"][0]["exam_id"]

    def status():
        r = client.get(f"/api/exams/{exam_id}/practice-status",
                       headers=auth(USER_A))
        return {u["unit_id"]: u for u in r.json()["units"]}

    # unanswered formal submit still counts as one practice
    r = submit(client, USER_A, s["id"], suid, [])
    assert r.status_code == 200
    assert status()[CLOZE_UNIT]["submitted_count"] == 1

    # duplicate submit after completion is rejected and does NOT count again
    dup = submit(client, USER_A, s["id"], suid,
                 [(Q1, Q1 + "-o2"), (Q2, Q2 + "-o1")])
    assert dup.status_code == 409
    assert status()[CLOZE_UNIT]["submitted_count"] == 1

    # a formal 专项 practice of the same unit adds its own count
    p = create(client, USER_A, published_release, [CLOZE_UNIT]).json()
    submit(client, USER_A, p["id"], unit_id_map(p)[CLOZE_UNIT],
           [(Q1, Q1 + "-o2"), (Q2, Q2 + "-o1")])
    assert status()[CLOZE_UNIT]["submitted_count"] == 2
