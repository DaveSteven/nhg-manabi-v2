"""Strict mock exam backend (ADR-0019): state machine, server clock, leakage.

Fixture release: phase `p1` (600s) = the 2-question cloze unit, phase `p2`
(300s) = the single-question unit. Time travel = shifting the run window
into the past in the DB (the server clock is the only authority).
"""
import json
import os

import pytest
import sqlalchemy as sa

from conftest import CLOZE_UNIT, EXAM_ID, SINGLE_UNIT

requires_db = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"),
    reason="DATABASE_URL not set; requires migrated PostgreSQL")

USER_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
USER_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
Q1 = f"{CLOZE_UNIT}-q01"   # correct -o2
Q2 = f"{CLOZE_UNIT}-q02"   # correct -o1
QS = f"{SINGLE_UNIT}-q01"  # correct -o3
FORBIDDEN_KEYS = ("correct_option_id", "answer_key", "explanations",
                  "unit_explanations", "cues", "is_correct")


@pytest.fixture(autouse=True)
def _study_isolation(clean_study):
    """Wipe the study domain around each test."""


def make_client(monkeypatch, pg_engine):
    monkeypatch.setenv(
        "DATABASE_URL", pg_engine.url.render_as_string(hide_password=False))
    monkeypatch.setenv("AUTH_MODE", "dev_test")
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("DEV_TEST_USER_IDS", f"{USER_A},{USER_B}")
    from fastapi.testclient import TestClient
    from app.main import app
    return TestClient(app)


def auth(u):
    return {"Authorization": f"Bearer {u}"}


def add_phases(pg_engine, release_id, p1=600, p2=300):
    with pg_engine.begin() as conn:
        for pid, pos, title, dur, uid in (
                ("p1", 1, "言語知識", p1, CLOZE_UNIT),
                ("p2", 2, "聴解", p2, SINGLE_UNIT)):
            conn.execute(sa.text(
                "INSERT INTO release_exam_phases (release_id, phase_id,"
                " position, title, duration_seconds, playback_policy)"
                " VALUES (:r, :p, :pos, :t, :d, NULL)"),
                {"r": release_id, "p": pid, "pos": pos, "t": title, "d": dur})
            conn.execute(sa.text(
                "INSERT INTO release_phase_units (release_id, phase_id,"
                " unit_id, position) VALUES (:r, :p, :u, 1)"),
                {"r": release_id, "p": pid, "u": uid})


def start(client, user=USER_A):
    r = client.post("/api/mock-exams", json={"exam_id": EXAM_ID},
                    headers=auth(user))
    assert r.status_code == 201, r.text
    return r.json()


def unit_ids(state):
    return {u["unit_id"]: u["session_unit_id"] for u in state["active_units"]}


def submit_phase(client, sid, phase, answers, user=USER_A):
    return client.post(
        f"/api/mock-exams/{sid}/phases/{phase}/submit",
        json={"answers": [{"session_unit_id": su, "question_id": q,
                           "chosen_option_id": c} for su, q, c in answers]},
        headers=auth(user))


def shift(pg_engine, sid, seconds):
    with pg_engine.begin() as conn:
        conn.execute(sa.text(
            "UPDATE study_phase_runs SET started_at = started_at -"
            " make_interval(secs => :s), expires_at = expires_at -"
            " make_interval(secs => :s) WHERE session_id = :i AND closed_at"
            " IS NULL"), {"s": seconds, "i": sid})


def assert_no_leak(obj):
    text = json.dumps(obj)
    for k in FORBIDDEN_KEYS:
        assert f'"{k}"' not in text, k


# ----------------------------------------------------------- availability ----

@requires_db
def test_availability_requires_phases_and_complete_units(
        pg_engine, published_release, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    r = client.get(f"/api/exams/{EXAM_ID}/mock").json()
    assert r["available"] is False and r["reason"] == "no_phases"
    assert client.get("/api/exams/NOPE/mock").json()["reason"] == "exam_not_found"
    add_phases(pg_engine, published_release)
    r = client.get(f"/api/exams/{EXAM_ID}/mock").json()
    assert r["available"] is True and r["total_seconds"] == 900
    assert [p["unit_count"] for p in r["phases"]] == [1, 1]
    assert "release_id" not in r
    with pg_engine.begin() as conn:
        conn.execute(sa.text(
            "UPDATE release_units SET conversion_status = 'needs_review'"
            " WHERE unit_id = :u"), {"u": SINGLE_UNIT})
    assert client.get(f"/api/exams/{EXAM_ID}/mock").json()["reason"] == "units_not_ready"
    # not mockable -> cannot start, and nothing is created
    rr = client.post("/api/mock-exams", json={"exam_id": EXAM_ID},
                     headers=auth(USER_A))
    assert rr.status_code == 422 and rr.json()["detail"]["reason"] == "units_not_ready"


@requires_db
def test_mock_endpoints_require_auth(pg_engine, published_release, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    assert client.post("/api/mock-exams", json={"exam_id": EXAM_ID}).status_code == 401
    assert client.get("/api/mock-exams/current").status_code == 401


# ------------------------------------------------------------ happy path ----

@requires_db
def test_full_flow_phases_in_order_results_after_last(
        pg_engine, published_release, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    add_phases(pg_engine, published_release)
    st = start(client)
    sid = st["id"]
    assert st["state"] == "in_progress" and st["active_phase_id"] == "p1"
    assert [p["status"] for p in st["phases"]] == ["active", "upcoming"]
    assert 595 <= st["phases"][0]["remaining_seconds"] <= 600
    assert st["phases"][1]["remaining_seconds"] is None
    assert set(unit_ids(st)) == {CLOZE_UNIT}          # only the active Phase
    assert_no_leak(st)

    su1 = unit_ids(st)[CLOZE_UNIT]
    unit = client.get(f"/api/mock-exams/{sid}/units/{su1}", headers=auth(USER_A))
    assert unit.status_code == 200 and unit.json()["id"] == CLOZE_UNIT
    assert_no_leak(unit.json())

    # a future Phase's unit is not served (and not even confirmed to exist)
    with pg_engine.connect() as conn:
        su2 = str(conn.execute(sa.text(
            "SELECT id FROM study_session_units WHERE session_id = :s"
            " AND unit_id = :u"), {"s": sid, "u": SINGLE_UNIT}).scalar())
    r = client.get(f"/api/mock-exams/{sid}/units/{su2}", headers=auth(USER_A))
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "unit_not_in_active_phase"
    assert client.put(
        f"/api/mock-exams/{sid}/units/{su2}/drafts", headers=auth(USER_A),
        json={"question_id": QS, "chosen_option_id": QS + "-o3",
              "expected_row_version": 0}).status_code == 409

    # no results before the last Phase closes
    r = client.get(f"/api/mock-exams/{sid}/results", headers=auth(USER_A))
    assert r.status_code == 409 and r.json()["detail"]["code"] == "mock_not_finished"

    # draft + refresh-restore
    d = client.put(f"/api/mock-exams/{sid}/units/{su1}/drafts", headers=auth(USER_A),
                   json={"question_id": Q1, "chosen_option_id": Q1 + "-o2",
                         "expected_row_version": 0})
    assert d.status_code == 200 and d.json()["row_version"] == 1
    drafts = client.get(f"/api/mock-exams/{sid}/drafts", headers=auth(USER_A)).json()
    assert [x["question_id"] for x in drafts["drafts"]] == [Q1]
    assert_no_leak(drafts)

    # close phase 1 (Q1 right, Q2 left blank)
    r = submit_phase(client, sid, "p1", [(su1, Q1, Q1 + "-o2")])
    assert r.status_code == 200, r.text
    st2 = r.json()
    assert st2["idempotent"] is False and st2["active_phase_id"] == "p2"
    assert [p["status"] for p in st2["phases"]] == ["closed", "active"]
    assert set(unit_ids(st2)) == {SINGLE_UNIT}
    assert_no_leak(st2)

    # closed Phase: no look-back, no edits, double submit is harmless
    assert client.get(f"/api/mock-exams/{sid}/units/{su1}",
                      headers=auth(USER_A)).status_code == 409
    assert client.put(f"/api/mock-exams/{sid}/units/{su1}/drafts",
                      headers=auth(USER_A),
                      json={"question_id": Q1, "chosen_option_id": Q1 + "-o1",
                            "expected_row_version": 1}).status_code == 409
    again = submit_phase(client, sid, "p1", [(su1, Q1, Q1 + "-o1")]).json()
    assert again["idempotent"] is True and again["active_phase_id"] == "p2"
    # submitting a Phase that has not started is refused
    with pg_engine.connect() as conn:
        n = conn.execute(sa.text(
            "SELECT count(*) FROM study_submitted_answers sa JOIN"
            " study_session_units su ON su.id = sa.session_unit_id"
            " WHERE su.session_id = :s"), {"s": sid}).scalar()
    assert n == 2          # Q1 + Q2(skip); the retry wrote nothing

    su2 = unit_ids(again)[SINGLE_UNIT]
    done = submit_phase(client, sid, "p2", [(su2, QS, QS + "-o1")]).json()
    assert done["state"] == "completed" and done["active_phase_id"] is None
    assert done["results_available"] is True and done["active_units"] == []

    res = client.get(f"/api/mock-exams/{sid}/results", headers=auth(USER_A)).json()
    assert (res["correct_count"], res["wrong_count"], res["skipped_count"]) == (1, 1, 1)
    assert res["scoring_method"] == "mock_phases"
    p = {x["phase_id"]: x for x in res["phases"]}
    assert (p["p1"]["correct"], p["p1"]["skipped"], p["p1"]["answered_accuracy"]) == (1, 1, 1.0)
    assert (p["p2"]["wrong"], p["p2"]["answered_accuracy"]) == (1, 0.0)
    assert {s["subject"] for s in res["subjects"]} == {"grammar", "vocabulary"}
    # review is open now
    assert any(q["correct_option_id"] for q in res["questions"])

    # separate from practice statistics
    with pg_engine.connect() as conn:
        assert conn.execute(sa.text(
            "SELECT count(*) FROM user_question_progress")).scalar() == 0


@requires_db
def test_phase_submit_validation_and_isolation(
        pg_engine, published_release, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    add_phases(pg_engine, published_release)
    st = start(client)
    sid = st["id"]
    assert submit_phase(client, sid, "p2", []).status_code == 409   # not started
    assert submit_phase(client, sid, "nope", []).status_code == 404
    # answer for a unit outside the Phase rolls back everything
    with pg_engine.connect() as conn:
        su2 = str(conn.execute(sa.text(
            "SELECT id FROM study_session_units WHERE session_id = :s AND"
            " unit_id = :u"), {"s": sid, "u": SINGLE_UNIT}).scalar())
    r = submit_phase(client, sid, "p1", [(su2, QS, QS + "-o1")])
    assert r.status_code == 422
    assert client.get(f"/api/mock-exams/{sid}", headers=auth(USER_A)).json()[
        "active_phase_id"] == "p1"
    # another user sees nothing
    assert client.get(f"/api/mock-exams/{sid}", headers=auth(USER_B)).status_code == 404
    assert submit_phase(client, sid, "p1", [], user=USER_B).status_code == 404
    assert client.get("/api/mock-exams/current", headers=auth(USER_B)).status_code == 404
    cur = client.get("/api/mock-exams/current", headers=auth(USER_A))
    assert cur.status_code == 200 and cur.json()["id"] == sid


# ------------------------------------------------------------ server clock ----

@requires_db
def test_expiry_seals_phase_from_drafts_and_starts_next_at_expiry(
        pg_engine, published_release, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    add_phases(pg_engine, published_release)
    st = start(client)
    sid = st["id"]
    su1 = unit_ids(st)[CLOZE_UNIT]
    client.put(f"/api/mock-exams/{sid}/units/{su1}/drafts", headers=auth(USER_A),
               json={"question_id": Q1, "chosen_option_id": Q1 + "-o2",
                     "expected_row_version": 0})
    client.put(f"/api/mock-exams/{sid}/units/{su1}/drafts", headers=auth(USER_A),
               json={"question_id": Q2, "chosen_option_id": Q2 + "-o3",
                     "expected_row_version": 0})
    shift(pg_engine, sid, 700)      # phase 1 ended ~100s ago; phase 2 = 300s

    s = client.get(f"/api/mock-exams/{sid}", headers=auth(USER_A)).json()
    assert [p["status"] for p in s["phases"]] == ["closed", "active"]
    assert 150 <= s["phases"][1]["remaining_seconds"] <= 205   # clock kept running
    assert set(unit_ids(s)) == {SINGLE_UNIT}
    with pg_engine.connect() as conn:
        rows = dict(conn.execute(sa.text(
            "SELECT question_id, is_correct FROM study_submitted_answers sa"
            " JOIN study_session_units su ON su.id = sa.session_unit_id"
            " WHERE su.session_id = :s"), {"s": sid}).all())
    assert rows == {Q1: True, Q2: False}
    # a late request cannot edit the sealed Phase
    assert client.put(f"/api/mock-exams/{sid}/units/{su1}/drafts",
                      headers=auth(USER_A),
                      json={"question_id": Q1, "chosen_option_id": Q1 + "-o1",
                            "expected_row_version": 1}).status_code == 409
    # late explicit submit of the already-sealed Phase is an idempotent no-op
    late = submit_phase(client, sid, "p1", [(su1, Q1, Q1 + "-o1")]).json()
    assert late["idempotent"] is True


@requires_db
def test_long_absence_seals_every_phase_and_completes_with_skips(
        pg_engine, published_release, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    add_phases(pg_engine, published_release)
    sid = start(client)["id"]
    shift(pg_engine, sid, 7200)       # away for two hours
    s = client.get(f"/api/mock-exams/{sid}", headers=auth(USER_A)).json()
    assert s["state"] == "completed" and s["active_phase_id"] is None
    res = client.get(f"/api/mock-exams/{sid}/results", headers=auth(USER_A)).json()
    # nothing was chosen -> all skips, never wrong
    assert (res["correct_count"], res["wrong_count"], res["skipped_count"]) == (0, 0, 3)
    assert res["answered_accuracy"] is None
    assert client.get("/api/mock-exams/current", headers=auth(USER_A)).status_code == 404
    # sealing on a read is idempotent
    assert client.get(f"/api/mock-exams/{sid}", headers=auth(USER_A)).json()["state"] == "completed"


# --------------------------------------------------------------- one slot ----

def states(pg_engine, user=USER_A):
    with pg_engine.connect() as conn:
        return dict(conn.execute(sa.text(
            "SELECT id::text, state FROM study_sessions WHERE user_id = :u"),
            {"u": user}).all())


@requires_db
def test_mock_and_practice_replace_each_other_without_prompt(
        pg_engine, published_release, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    add_phases(pg_engine, published_release)
    practice = client.post("/api/topic-practice/sessions", json={
        "level": "N5", "question_type_id": "grammar_cloze", "count": 1,
        "feedback_mode": "immediate"}, headers=auth(USER_A)).json()
    quick = client.post("/api/quick-practice/sessions", json={
        "release_id": str(published_release), "unit_id": SINGLE_UNIT},
        headers=auth(USER_A)).json()
    m1 = start(client)
    st = states(pg_engine)
    assert st[practice["id"]] == "abandoned"          # mock replaced practice
    assert st[quick["id"]] == "in_progress"           # quick untouched
    assert st[m1["id"]] == "in_progress"

    m2 = start(client)                                # new mock replaces old
    st = states(pg_engine)
    assert st[m1["id"]] == "abandoned" and st[m2["id"]] == "in_progress"
    # abandoned mock is gone for the user
    assert client.get(f"/api/mock-exams/{m1['id']}/units/x",
                      headers=auth(USER_A)).status_code in (404, 422)

    p2 = client.post("/api/topic-practice/sessions", json={
        "level": "N5", "question_type_id": "grammar_cloze", "count": 1,
        "feedback_mode": "immediate"}, headers=auth(USER_A)).json()
    st = states(pg_engine)
    assert st[m2["id"]] == "abandoned" and st[p2["id"]] == "in_progress"
    assert st[quick["id"]] == "in_progress"
    # an abandoned mock can no longer be submitted into
    assert submit_phase(client, m2["id"], "p1", []).status_code in (404, 409)
    assert client.get("/api/mock-exams/current", headers=auth(USER_A)).status_code == 404


@requires_db
def test_db_forbids_two_active_main_sessions(pg_engine, published_release,
                                             monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    add_phases(pg_engine, published_release)
    start(client)
    with pytest.raises(sa.exc.IntegrityError):
        with pg_engine.begin() as conn:
            conn.execute(sa.text(
                "INSERT INTO study_sessions (id, user_id, mode, feedback_mode,"
                " state, config) VALUES (gen_random_uuid(), :u, 'practice',"
                " 'immediate', 'in_progress', '{}'::jsonb)"), {"u": USER_A})
    with pytest.raises(sa.exc.IntegrityError):
        with pg_engine.begin() as conn:                # one run per phase
            conn.execute(sa.text(
                "INSERT INTO study_phase_runs (id, session_id, release_id,"
                " phase_id, started_at, expires_at) SELECT gen_random_uuid(),"
                " session_id, release_id, phase_id, now(), now() +"
                " interval '1 minute' FROM study_phase_runs"))


@requires_db
def test_concurrent_phase_submits_close_the_phase_once(
        pg_engine, published_release, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    client = make_client(monkeypatch, pg_engine)
    add_phases(pg_engine, published_release)
    st = start(client)
    sid, su1 = st["id"], unit_ids(st)[CLOZE_UNIT]

    def go(_):
        return submit_phase(client, sid, "p1", [(su1, Q1, Q1 + "-o2")])

    with ThreadPoolExecutor(4) as ex:
        rs = list(ex.map(go, range(4)))
    assert all(r.status_code == 200 for r in rs)
    assert sorted(r.json()["idempotent"] for r in rs) == [False, True, True, True]
    s = client.get(f"/api/mock-exams/{sid}", headers=auth(USER_A)).json()
    assert s["active_phase_id"] == "p2"       # a retry never closed the next one
    with pg_engine.connect() as conn:
        assert conn.execute(sa.text(
            "SELECT count(*) FROM study_submitted_answers sa JOIN"
            " study_session_units su ON su.id = sa.session_unit_id"
            " WHERE su.session_id = :s"), {"s": sid}).scalar() == 2
