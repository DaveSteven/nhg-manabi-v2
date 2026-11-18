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
    content = client.get(f"/api/mock-exams/{sid}/content", headers=auth(USER_A))
    assert content.status_code == 200
    body = content.json()
    assert body["phase_id"] == "p1"
    assert [u["id"] for u in body["units"]] == [CLOZE_UNIT]   # active Phase only
    assert body["units"][0]["session_unit_id"] == su1
    assert body["units"][0]["layer"]["subject"] == "grammar"
    assert isinstance(body["units"][0]["layer"]["question_type_label"], str)
    assert_no_leak(body)

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
    c2 = client.get(f"/api/mock-exams/{sid}/content", headers=auth(USER_A)).json()
    assert c2["phase_id"] == "p2" and [u["id"] for u in c2["units"]] == [SINGLE_UNIT]
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
def test_mock_is_independent_of_practice_and_quick(
        pg_engine, published_release, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    add_phases(pg_engine, published_release)
    practice = client.post("/api/topic-practice/sessions", json={
        "level": "N5", "question_type_id": "grammar_cloze", "count": 1,
        "feedback_mode": "immediate"}, headers=auth(USER_A)).json()
    quick = client.post("/api/quick-practice/sessions", json={
        "release_id": str(published_release), "unit_id": SINGLE_UNIT},
        headers=auth(USER_A)).json()
    m = start(client)                       # starting a mock touches neither
    st = states(pg_engine)
    assert st[practice["id"]] == st[quick["id"]] == st[m["id"]] == "in_progress"

    # starting practice (new topic session) leaves the running mock alone
    p2 = client.post("/api/topic-practice/sessions", json={
        "level": "N5", "question_type_id": "vocabulary_kanji_reading",
        "count": 1, "feedback_mode": "immediate"}, headers=auth(USER_A)).json()
    client.post("/api/quick-practice/sessions", json={
        "release_id": str(published_release), "unit_id": CLOZE_UNIT},
        headers=auth(USER_A))
    st = states(pg_engine)
    assert st[practice["id"]] == "abandoned" and st[p2["id"]] == "in_progress"
    assert st[m["id"]] == "in_progress"
    s = client.get(f"/api/mock-exams/{m['id']}", headers=auth(USER_A)).json()
    assert s["state"] == "in_progress" and s["active_phase_id"] == "p1"
    assert client.get("/api/mock-exams/current",
                      headers=auth(USER_A)).json()["id"] == m["id"]
    # mock answers/submits don't disturb the practice session either
    su1 = unit_ids(s)[CLOZE_UNIT]
    assert submit_phase(client, m["id"], "p1", [(su1, Q1, Q1 + "-o2")]).status_code == 200
    assert states(pg_engine)[p2["id"]] == "in_progress"


@requires_db
def test_second_mock_needs_explicit_replace(pg_engine, published_release,
                                            monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    add_phases(pg_engine, published_release)
    m1 = start(client)
    r = client.post("/api/mock-exams", json={"exam_id": EXAM_ID},
                    headers=auth(USER_A))
    assert r.status_code == 409
    d = r.json()["detail"]
    assert d["code"] == "mock_in_progress" and d["session_id"] == m1["id"]
    assert d["exam_id"] == EXAM_ID
    assert states(pg_engine)[m1["id"]] == "in_progress"     # nothing lost
    r = client.post("/api/mock-exams", json={"exam_id": EXAM_ID,
                                             "replace_active": True},
                    headers=auth(USER_A))
    assert r.status_code == 201
    m2 = r.json()
    st = states(pg_engine)
    assert st[m1["id"]] == "abandoned" and st[m2["id"]] == "in_progress"
    assert submit_phase(client, m1["id"], "p1", []).status_code == 409
    # a finished-by-time mock never blocks a new start
    shift(pg_engine, m2["id"], 7200)
    r = client.post("/api/mock-exams", json={"exam_id": EXAM_ID},
                    headers=auth(USER_A))
    assert r.status_code == 201
    assert states(pg_engine)[m2["id"]] == "completed"
    # another user is unaffected
    assert start(client, USER_B)["state"] == "in_progress"


@requires_db
def test_db_allows_one_practice_plus_one_mock_but_not_two_of_a_kind(
        pg_engine, published_release, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    add_phases(pg_engine, published_release)
    start(client)
    ins = ("INSERT INTO study_sessions (id, user_id, mode, feedback_mode,"
           " state, mock_release_id, config) VALUES (gen_random_uuid(), :u,"
           " :m, 'immediate', 'in_progress', {r}, '{{}}'::jsonb)")
    with pg_engine.begin() as conn:       # practice next to a mock: allowed
        conn.execute(sa.text(ins.format(r="NULL")), {"u": USER_A, "m": "practice"})
    with pytest.raises(sa.exc.IntegrityError):
        with pg_engine.begin() as conn:
            conn.execute(sa.text(ins.format(r="NULL")), {"u": USER_A, "m": "practice"})
    with pytest.raises(sa.exc.IntegrityError):
        with pg_engine.begin() as conn:
            conn.execute(sa.text(ins.format(r=f"'{published_release}'")),
                         {"u": USER_A, "m": "mock"})
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


# ---------------------------------------------------------------- listening ----

AUDIO_MAT = f"{SINGLE_UNIT}-m-audio"


CLIP_ASSET = "JLPTGO-N5-TEST-EX-as001"


@pytest.fixture(autouse=True)
def _clip_storage_cleanup(pg_engine):
    yield
    with pg_engine.begin() as conn:
        conn.execute(sa.text(
            "DELETE FROM media_storage WHERE asset_id = :a"), {"a": CLIP_ASSET})


def store_clip(pg_engine, state="stored", verified_ms=30000):
    """The clip's file as the media sync would record it (R4: a mock only
    opens when listening is actually playable)."""
    with pg_engine.begin() as conn:
        conn.execute(sa.text("DELETE FROM media_storage WHERE asset_id = :a"),
                     {"a": CLIP_ASSET})
        conn.execute(sa.text(
            "INSERT INTO media_storage (asset_id, state, verified_duration_ms,"
            " rule_version) VALUES (:a, :s, :d, 'test')"),
            {"a": CLIP_ASSET, "s": state, "d": verified_ms})


def add_audio(pg_engine, release_id, duration_ms=30000, stored=True):
    if stored:
        store_clip(pg_engine, verified_ms=duration_ms)
    with pg_engine.begin() as conn:
        conn.execute(sa.text(
            "INSERT INTO release_unit_materials (release_id, material_id,"
            " unit_id, position, kind, role, language, content, cues, asset_id)"
            " VALUES (:r, :m, :u, 9, 'audio', 'primary', 'ja', NULL, NULL,"
            " 'JLPTGO-N5-TEST-EX-as001')"),
            {"r": release_id, "m": AUDIO_MAT, "u": SINGLE_UNIT})
        conn.execute(sa.text(
            "UPDATE media_assets SET duration_ms = :d WHERE id ="
            " 'JLPTGO-N5-TEST-EX-as001'"), {"d": duration_ms})


def to_phase2(client, pg_engine, sid):
    with pg_engine.connect() as conn:
        su1 = str(conn.execute(sa.text(
            "SELECT id FROM study_session_units WHERE session_id = :s AND"
            " unit_id = :u"), {"s": sid, "u": CLOZE_UNIT}).scalar())
    st = submit_phase(client, sid, "p1", [(su1, Q1, Q1 + "-o2")]).json()
    assert st["active_phase_id"] == "p2"
    return unit_ids(st)[SINGLE_UNIT]


def start_audio(client, sid, su, user=USER_A):
    return client.post(
        f"/api/mock-exams/{sid}/units/{su}/audio/{AUDIO_MAT}/start",
        headers=auth(user))


@requires_db
def test_audio_plays_once_on_a_server_timeline(pg_engine, published_release,
                                               monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    add_phases(pg_engine, published_release)
    add_audio(pg_engine, published_release)
    sid = start(client)["id"]
    # not in the active phase yet: cannot start (and the unit is not served)
    with pg_engine.connect() as conn:
        su2 = str(conn.execute(sa.text(
            "SELECT id FROM study_session_units WHERE session_id = :s AND"
            " unit_id = :u"), {"s": sid, "u": SINGLE_UNIT}).scalar())
    assert start_audio(client, sid, su2).status_code == 409
    su2 = to_phase2(client, pg_engine, sid)

    # content reports idle before pressing play; never a transcript / cues
    c = client.get(f"/api/mock-exams/{sid}/content", headers=auth(USER_A)).json()
    a = c["units"][0]["audio"]
    assert a == [{"material_id": AUDIO_MAT, "state": "idle", "position_ms": 0,
                  "duration_ms": 30000}]
    assert_no_leak(c)

    r = start_audio(client, sid, su2)
    assert r.status_code == 200 and r.json()["state"] == "playing"
    assert r.json()["position_ms"] < 2000
    with pg_engine.connect() as conn:
        t0 = conn.execute(sa.text(
            "SELECT started_at FROM study_audio_plays")).scalar()
    # second press / refresh / other tab: same start time, live position
    r2 = start_audio(client, sid, su2).json()
    assert r2["state"] == "playing"
    with pg_engine.connect() as conn:
        assert conn.execute(sa.text(
            "SELECT count(*), min(started_at) FROM study_audio_plays")).one() == (1, t0)

    # 10s later the live position follows the server clock
    with pg_engine.begin() as conn:
        conn.execute(sa.text(
            "UPDATE study_audio_plays SET started_at = started_at - interval"
            " '10 seconds'"))
    pos = client.get(f"/api/mock-exams/{sid}/content", headers=auth(USER_A)
                     ).json()["units"][0]["audio"][0]
    assert pos["state"] == "playing" and 10000 <= pos["position_ms"] < 13000

    # after the duration it is consumed for good: no replay
    with pg_engine.begin() as conn:
        conn.execute(sa.text(
            "UPDATE study_audio_plays SET started_at = started_at - interval"
            " '60 seconds'"))
    done = start_audio(client, sid, su2).json()
    assert done["state"] == "ended" and done["position_ms"] == 30000
    with pg_engine.connect() as conn:
        assert conn.execute(sa.text(
            "SELECT count(*) FROM study_audio_plays")).scalar() == 1


@requires_db
def test_audio_start_validation_and_isolation(pg_engine, published_release,
                                              monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    add_phases(pg_engine, published_release)
    add_audio(pg_engine, published_release)
    sid = start(client)["id"]
    su2 = to_phase2(client, pg_engine, sid)
    assert client.post(
        f"/api/mock-exams/{sid}/units/{su2}/audio/nope/start",
        headers=auth(USER_A)).status_code == 404
    assert start_audio(client, sid, su2, user=USER_B).status_code == 404
    assert client.post(
        f"/api/mock-exams/{sid}/units/{su2}/audio/{AUDIO_MAT}/start"
    ).status_code == 401
    # once the phase is sealed the audio can no longer be started
    shift(pg_engine, sid, 7200)
    assert start_audio(client, sid, su2).status_code == 409


# ------------------------------------------- continuous listening (ADR-0022) ----

FULL = "JLPTGO-N5-TEST-EX-full"


@pytest.fixture()
def full_audio(pg_engine, published_release):
    """p2 becomes a listening Phase (its unit carries a clip) and the exam
    gets a stored full recording of 40s."""
    add_audio(pg_engine, published_release)
    with pg_engine.begin() as conn:
        conn.execute(sa.text(
            "INSERT INTO media_assets (id, sha256, storage_key, mime_type,"
            " duration_ms, availability) VALUES (:a, :h, 'assets/test/full.mp3',"
            " 'audio/mpeg', NULL, 'verified')"), {"a": FULL, "h": "f" * 64})
        conn.execute(sa.text(
            "INSERT INTO release_exam_media (release_id, asset_id, role)"
            " VALUES (:r, :a, 'full_audio')"), {"r": published_release, "a": FULL})
        conn.execute(sa.text(
            "INSERT INTO media_storage (asset_id, state, verified_duration_ms,"
            " rule_version) VALUES (:a, 'stored', 40000, 'test')"), {"a": FULL})
    yield FULL
    with pg_engine.begin() as conn:
        conn.execute(sa.text("DELETE FROM study_phase_audio_plays"))
        conn.execute(sa.text("DELETE FROM media_storage WHERE asset_id = :a"), {"a": FULL})
        conn.execute(sa.text("DELETE FROM release_exam_media WHERE asset_id = :a"), {"a": FULL})
        conn.execute(sa.text("DELETE FROM media_assets WHERE id = :a"), {"a": FULL})


def start_phase_audio(client, sid, phase="p2", user=USER_A):
    return client.post(f"/api/mock-exams/{sid}/phases/{phase}/audio/start",
                       headers=auth(user))


@requires_db
def test_listening_phase_plays_the_full_recording_once(pg_engine, published_release,
                                                       full_audio, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    add_phases(pg_engine, published_release)
    sid = start(client)["id"]
    # the reading phase has no continuous audio, and p2 cannot start yet
    c1 = client.get(f"/api/mock-exams/{sid}/content", headers=auth(USER_A)).json()
    assert c1["phase_audio"] is None
    assert start_phase_audio(client, sid).status_code == 409
    su2 = to_phase2(client, pg_engine, sid)

    c = client.get(f"/api/mock-exams/{sid}/content", headers=auth(USER_A)).json()
    assert c["phase_audio"] == {"asset_id": FULL, "state": "idle",
                                "position_ms": 0, "duration_ms": 40000}
    # per-question clips are withheld and cannot be played on their own
    unit = c["units"][0]
    assert unit["audio"] == []
    assert all(m["kind"] != "audio" for m in unit["materials"])
    assert start_audio(client, sid, su2).status_code == 409
    assert_no_leak(c)

    r = start_phase_audio(client, sid)
    assert r.status_code == 200 and r.json()["state"] == "playing"
    with pg_engine.connect() as conn:
        t0 = conn.execute(sa.text(
            "SELECT started_at FROM study_phase_audio_plays")).scalar()
    # refresh / second press: same timeline, never restarted
    assert start_phase_audio(client, sid).json()["state"] == "playing"
    with pg_engine.begin() as conn:
        assert conn.execute(sa.text(
            "SELECT count(*), min(started_at) FROM study_phase_audio_plays")
        ).one() == (1, t0)
        conn.execute(sa.text(
            "UPDATE study_phase_audio_plays SET started_at = started_at -"
            " interval '15 seconds'"))
    live = client.get(f"/api/mock-exams/{sid}/content", headers=auth(USER_A)
                      ).json()["phase_audio"]
    assert live["state"] == "playing" and 15000 <= live["position_ms"] < 18000
    # after the duration: consumed for good
    with pg_engine.begin() as conn:
        conn.execute(sa.text(
            "UPDATE study_phase_audio_plays SET started_at = started_at -"
            " interval '60 seconds'"))
    done = start_phase_audio(client, sid).json()
    assert done == {"asset_id": FULL, "state": "ended", "position_ms": 40000,
                    "duration_ms": 40000}


@requires_db
def test_listening_clock_starts_when_listening_is_confirmed(
        pg_engine, published_release, full_audio, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    add_phases(pg_engine, published_release)
    sid = start(client)["id"]
    to_phase2(client, pg_engine, sid)
    # confirm page: idle for ever, the clock never runs and cannot seal
    shift(pg_engine, sid, 99999)
    st = client.get(f"/api/mock-exams/{sid}", headers=auth(USER_A)).json()
    assert st["state"] == "in_progress" and st["active_phase_id"] == "p2"
    p2 = next(p for p in st["phases"] if p["phase_id"] == "p2")
    assert p2["remaining_seconds"] == p2["duration_seconds"]
    # confirming starts the clock from the full duration
    assert start_phase_audio(client, sid).status_code == 200
    st = client.get(f"/api/mock-exams/{sid}", headers=auth(USER_A)).json()
    p2 = next(p for p in st["phases"] if p["phase_id"] == "p2")
    assert p2["duration_seconds"] - 5 <= p2["remaining_seconds"] <= p2["duration_seconds"]
    # now it expires normally
    shift(pg_engine, sid, 7200)
    st = client.get(f"/api/mock-exams/{sid}", headers=auth(USER_A)).json()
    assert st["state"] == "completed"


@requires_db
def test_abandon_mock_exam(pg_engine, published_release, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    add_phases(pg_engine, published_release)
    sid = start(client)["id"]
    url = f"/api/mock-exams/{sid}/abandon"
    assert client.post(url).status_code == 401
    assert client.post(url, headers=auth(USER_B)).status_code == 404
    r = client.post(url, headers=auth(USER_A))
    assert r.status_code == 200 and r.json()["state"] == "abandoned"
    assert client.post(url, headers=auth(USER_A)).json()["state"] == "abandoned"
    assert client.get("/api/mock-exams/current", headers=auth(USER_A)).status_code == 404


@requires_db
def test_phase_audio_isolation_and_fallback(pg_engine, published_release,
                                            full_audio, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    add_phases(pg_engine, published_release)
    sid = start(client)["id"]
    su2 = to_phase2(client, pg_engine, sid)
    assert start_phase_audio(client, sid, user=USER_B).status_code == 404
    assert client.post(f"/api/mock-exams/{sid}/phases/p2/audio/start").status_code == 401
    assert start_phase_audio(client, sid, phase="p1").status_code == 409
    # without a stored recording the per-unit strict player applies again
    with pg_engine.begin() as conn:
        conn.execute(sa.text(
            "UPDATE media_storage SET state = 'unavailable' WHERE asset_id = :a"),
            {"a": FULL})
    c = client.get(f"/api/mock-exams/{sid}/content", headers=auth(USER_A)).json()
    assert c["phase_audio"] is None and c["units"][0]["audio"][0]["state"] == "idle"
    assert start_phase_audio(client, sid).status_code == 404
    assert start_audio(client, sid, su2).status_code == 200
    # a sealed phase can no longer be started
    shift(pg_engine, sid, 7200)
    assert start_phase_audio(client, sid).status_code == 409


# ------------------------------------------------ practice route isolation ----

@requires_db
@pytest.mark.parametrize("abandon_first", [False, True])
def test_mock_id_is_invisible_to_every_practice_endpoint(
        pg_engine, published_release, monkeypatch, abandon_first):
    """R3: /api/practice/* never touches a mock session — in progress or
    abandoned. Answers submitted in an earlier Phase stay unreadable through
    the ordinary feedback/transcript/results routes; finish cannot flip the
    mock state. Every call answers like an unknown id (404)."""
    client = make_client(monkeypatch, pg_engine)
    add_phases(pg_engine, published_release)
    st = start(client)
    sid = st["id"]
    su1 = unit_ids(st)[CLOZE_UNIT]
    r = submit_phase(client, sid, "p1", [(su1, Q1, Q1 + "-o2"), (su1, Q2, Q2 + "-o1")])
    assert r.status_code == 200, r.text
    if abandon_first:
        assert client.post(f"/api/mock-exams/{sid}/abandon",
                           headers=auth(USER_A)).status_code == 200
    with pg_engine.connect() as conn:
        before = conn.execute(sa.text(
            "SELECT state, version FROM study_sessions WHERE id = :s"),
            {"s": sid}).one()

    h = auth(USER_A)
    p = f"/api/practice/sessions/{sid}"
    calls = [
        client.get(p, headers=h),
        client.get(p + "/drafts", headers=h),
        client.put(f"{p}/units/{su1}/drafts", headers=h,
                   json={"question_id": Q1, "chosen_option_id": Q1 + "-o1",
                         "expected_row_version": 0}),
        client.post(f"{p}/units/{su1}/submit", headers=h, json={"answers": []}),
        client.get(f"{p}/units/{su1}/feedback", headers=h),
        client.get(f"{p}/units/{su1}/transcript", headers=h),
        client.post(p + "/finish", headers=h),
        client.post(p + "/submit", headers=h, json={"answers": []}),
        client.get(p + "/results", headers=h),
    ]
    for resp in calls:
        assert resp.status_code == 404, (resp.request.url, resp.text)
        assert_no_leak(resp.json())

    with pg_engine.connect() as conn:
        after = conn.execute(sa.text(
            "SELECT state, version FROM study_sessions WHERE id = :s"),
            {"s": sid}).one()
    assert tuple(after) == tuple(before)   # nothing was mutated
    if not abandon_first:                  # the mock itself is still alive
        again = client.get(f"/api/mock-exams/{sid}", headers=h)
        assert again.status_code == 200 and again.json()["state"] == "in_progress"


# ------------------------------------------- R4: listening playability ----

def availability(client):
    return client.get(f"/api/exams/{EXAM_ID}/mock").json()


@requires_db
def test_clip_without_stored_file_blocks_mock_and_play(
        pg_engine, published_release, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    add_phases(pg_engine, published_release)
    add_audio(pg_engine, published_release, stored=False)   # no file at all
    a = availability(client)
    assert a["available"] is False and a["reason"] == "listening_audio_unavailable"
    r = client.post("/api/mock-exams", json={"exam_id": EXAM_ID},
                    headers=auth(USER_A))
    assert r.status_code != 201


@requires_db
@pytest.mark.parametrize("state,verified_ms,asset_duration", [
    ("unavailable", 30000, 30000),   # file not stored
    ("stored", None, None),           # stored, unknown duration
    ("stored", 0, None),              # stored, zero duration
])
def test_unplayable_clip_states_block_availability(
        pg_engine, published_release, monkeypatch,
        state, verified_ms, asset_duration):
    client = make_client(monkeypatch, pg_engine)
    add_phases(pg_engine, published_release)
    add_audio(pg_engine, published_release, stored=False)
    store_clip(pg_engine, state=state, verified_ms=verified_ms)
    with pg_engine.begin() as conn:
        conn.execute(sa.text("UPDATE media_assets SET duration_ms = :d"
                             " WHERE id = :a"),
                     {"d": asset_duration, "a": CLIP_ASSET})
    assert availability(client)["reason"] == "listening_audio_unavailable"


@requires_db
def test_corrupt_clip_blocks_availability(pg_engine, published_release,
                                          monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    add_phases(pg_engine, published_release)
    add_audio(pg_engine, published_release)
    assert availability(client)["available"] is True
    with pg_engine.begin() as conn:
        conn.execute(sa.text("UPDATE media_assets SET availability = 'corrupt'"
                             " WHERE id = :a"), {"a": CLIP_ASSET})
    assert availability(client)["reason"] == "listening_audio_unavailable"


@requires_db
def test_full_recording_makes_missing_clips_irrelevant(
        pg_engine, published_release, full_audio, monkeypatch):
    """Continuous mode needs only the full recording; clips are withheld."""
    client = make_client(monkeypatch, pg_engine)
    add_phases(pg_engine, published_release)
    with pg_engine.begin() as conn:
        conn.execute(sa.text("DELETE FROM media_storage WHERE asset_id = :a"),
                     {"a": CLIP_ASSET})
    assert availability(client)["available"] is True


@requires_db
def test_both_sources_missing_blocks_and_recording_loss_falls_back_to_clips(
        pg_engine, published_release, full_audio, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    add_phases(pg_engine, published_release)
    with pg_engine.begin() as conn:
        # recording lost, clips present -> per-unit mode is fine
        conn.execute(sa.text("UPDATE media_storage SET state = 'unavailable'"
                             " WHERE asset_id = :a"), {"a": FULL})
    assert availability(client)["available"] is True
    with pg_engine.begin() as conn:
        # clips lost as well -> nothing playable
        conn.execute(sa.text("DELETE FROM media_storage WHERE asset_id = :a"),
                     {"a": CLIP_ASSET})
    assert availability(client)["reason"] == "listening_audio_unavailable"


@requires_db
def test_per_unit_start_refuses_unplayable_clip_without_burning_it(
        pg_engine, published_release, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    add_phases(pg_engine, published_release)
    add_audio(pg_engine, published_release)
    sid = start(client)["id"]
    su2 = to_phase2(client, pg_engine, sid)
    with pg_engine.begin() as conn:      # file disappears after the exam opened
        conn.execute(sa.text("DELETE FROM media_storage WHERE asset_id = :a"),
                     {"a": CLIP_ASSET})
    r = start_audio(client, sid, su2)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "audio_unavailable"
    with pg_engine.connect() as conn:
        assert conn.execute(sa.text(
            "SELECT count(*) FROM study_audio_plays")).scalar() == 0


# ------------------------------------------------- result review + history ----

def finish_mock(client, pg_engine, user=USER_A):
    """Q1 right, Q2 blank, QS wrong → (1,1,1)."""
    st = start(client, user)
    sid = st["id"]
    su1 = unit_ids(st)[CLOZE_UNIT]
    nxt = submit_phase(client, sid, "p1", [(su1, Q1, Q1 + "-o2")], user).json()
    su2 = unit_ids(nxt)[SINGLE_UNIT]
    done = submit_phase(client, sid, "p2", [(su2, QS, QS + "-o1")], user).json()
    assert done["state"] == "completed"
    return sid, su1, su2


@requires_db
def test_results_carry_header_and_per_question_review_keys(
        pg_engine, published_release, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    add_phases(pg_engine, published_release)
    sid, su1, su2 = finish_mock(client, pg_engine)
    res = client.get(f"/api/mock-exams/{sid}/results", headers=auth(USER_A)).json()
    assert res["exam_id"] == EXAM_ID and res["level"] and res["exam_title"]
    assert res["started_at"] and res["duration_seconds"] >= 0
    by_q = {q["question_id"]: q for q in res["questions"]}
    assert by_q[Q1]["session_unit_id"] == su1 and by_q[Q1]["phase_id"] == "p1"
    assert by_q[QS]["session_unit_id"] == su2 and by_q[QS]["phase_id"] == "p2"
    assert by_q[Q1]["subject"] == "grammar" and by_q[QS]["subject"] == "vocabulary"
    assert isinstance(by_q[Q1]["question_type_label"], str)
    assert by_q[Q2]["skipped"] is True and by_q[Q2]["is_correct"] is None


@requires_db
def test_review_feedback_and_transcript_open_only_after_completion(
        pg_engine, published_release, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    add_phases(pg_engine, published_release)
    st = start(client)
    sid = st["id"]
    su1 = unit_ids(st)[CLOZE_UNIT]
    for tail in ("feedback", "transcript"):
        r = client.get(f"/api/mock-exams/{sid}/units/{su1}/{tail}",
                       headers=auth(USER_A))
        assert r.status_code == 409
        assert r.json()["detail"]["code"] == "mock_not_finished"
    nxt = submit_phase(client, sid, "p1", [(su1, Q1, Q1 + "-o2")]).json()
    # still running (phase 2 open): the closed phase 1 stays sealed
    assert client.get(f"/api/mock-exams/{sid}/units/{su1}/feedback",
                      headers=auth(USER_A)).status_code == 409
    su2 = unit_ids(nxt)[SINGLE_UNIT]
    submit_phase(client, sid, "p2", [(su2, QS, QS + "-o1")])
    fb = client.get(f"/api/mock-exams/{sid}/units/{su1}/feedback",
                    headers=auth(USER_A))
    assert fb.status_code == 200
    q = {x["question_id"]: x for x in fb.json()["questions"]}
    assert q[Q1]["is_correct"] is True and q[Q1]["correct_option_id"] == Q1 + "-o2"
    assert q[Q2]["skipped"] is True and q[Q2]["correct_option_id"] == Q2 + "-o1"
    tr = client.get(f"/api/mock-exams/{sid}/units/{su1}/transcript",
                    headers=auth(USER_A))
    assert tr.status_code == 200 and tr.json()["materials"] == []
    # other users and foreign units get nothing
    assert client.get(f"/api/mock-exams/{sid}/units/{su1}/feedback",
                      headers=auth(USER_B)).status_code == 404
    bogus = "00000000-0000-0000-0000-000000000000"
    assert client.get(f"/api/mock-exams/{sid}/units/{bogus}/feedback",
                      headers=auth(USER_A)).status_code == 404


@requires_db
def test_abandoned_mock_has_no_review(pg_engine, published_release, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    add_phases(pg_engine, published_release)
    st = start(client)
    su1 = unit_ids(st)[CLOZE_UNIT]
    client.post(f"/api/mock-exams/{st['id']}/abandon", headers=auth(USER_A))
    assert client.get(f"/api/mock-exams/{st['id']}/units/{su1}/feedback",
                      headers=auth(USER_A)).status_code == 409
    assert client.get(f"/api/exams/{EXAM_ID}/mock-results",
                      headers=auth(USER_A)).json()["items"] == []


@requires_db
def test_exam_mock_results_list_is_own_completed_and_not_overwritten(
        pg_engine, published_release, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    add_phases(pg_engine, published_release)
    assert client.get(f"/api/exams/{EXAM_ID}/mock-results").status_code == 401
    first, _, _ = finish_mock(client, pg_engine)
    second, _, _ = finish_mock(client, pg_engine)
    other, _, _ = finish_mock(client, pg_engine, USER_B)
    items = client.get(f"/api/exams/{EXAM_ID}/mock-results",
                       headers=auth(USER_A)).json()["items"]
    assert {i["session_id"] for i in items} == {first, second}
    assert other not in {i["session_id"] for i in items}
    assert (items[0]["correct"], items[0]["wrong"], items[0]["skipped"],
            items[0]["total"]) == (1, 1, 1, 3)
    assert items[0]["answered_accuracy"] == 0.5
    assert client.get("/api/exams/NOPE/mock-results",
                      headers=auth(USER_A)).json()["items"] == []


@requires_db
def test_learning_history_lists_completed_mocks_with_kind_filter(
        pg_engine, published_release, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    add_phases(pg_engine, published_release)
    done, _, _ = finish_mock(client, pg_engine)
    st = start(client)               # running mock: not history
    client.post(f"/api/mock-exams/{st['id']}/abandon", headers=auth(USER_A))
    h = client.get("/api/me/learning/history", headers=auth(USER_A)).json()
    assert h["total"] == 1 and h["items"][0]["session_id"] == done
    it = h["items"][0]
    assert it["mode"] == "mock" and it["source"]["kind"] == "mock"
    assert it["has_result"] is True and it["total"] == 3
    assert (it["correct"], it["wrong"], it["skipped"]) == (1, 1, 1)
    for kind, n in (("mock", 1), ("quick", 0), ("topic", 0), ("all", 1)):
        r = client.get("/api/me/learning/history", params={"kind": kind},
                       headers=auth(USER_A)).json()
        assert r["total"] == n, kind
    assert client.get("/api/me/learning/history", params={"kind": "bad"},
                      headers=auth(USER_A)).status_code == 422
    # page past the end still reports the right total
    r = client.get("/api/me/learning/history",
                   params={"kind": "mock", "offset": 50},
                   headers=auth(USER_A)).json()
    assert r["items"] == [] and r["total"] == 1
