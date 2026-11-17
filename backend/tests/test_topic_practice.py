"""专项练习 API tests: type catalog (stage 1) and sampled sessions (stage 2).

The synthetic fixture is one N5 exam with exactly one grammar_cloze Unit
(2 questions) and one vocabulary_kanji_reading Unit (1 question).
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
QS = f"{SINGLE_UNIT}-q01"  # correct: -o3


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


def types(client, user, level="N5"):
    r = client.get(f"/api/topic-practice/types?level={level}", headers=auth(user))
    assert r.status_code == 200, r.text
    return {t["question_type_id"]: t for t in r.json()["types"]}


def create(client, user, qtype="grammar_cloze", count=1, level="N5",
           feedback="immediate"):
    return client.post("/api/topic-practice/sessions", json={
        "level": level, "question_type_id": qtype, "count": count,
        "feedback_mode": feedback}, headers=auth(user))


def submit(client, user, sid, suid, answers):
    return client.post(
        f"/api/practice/sessions/{sid}/units/{suid}/submit",
        json={"answers": [{"question_id": q, "chosen_option_id": c}
                          for q, c in answers]}, headers=auth(user))


@requires_db
def test_types_catalog_counts_and_level_filter(pg_engine, published_release,
                                               monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    t = types(client, USER_A)
    assert set(t) == {"grammar_cloze", "vocabulary_kanji_reading"}
    g = t["grammar_cloze"]
    assert (g["available_units"], g["available_questions"], g["new_units"]) \
        == (1, 2, 1)
    assert g["subject"] == "grammar" and g["unit_kind"] == "cloze"
    assert types(client, USER_A, "N1") == {}  # other level: nothing


@requires_db
def test_types_requires_auth_and_leaks_no_answers(pg_engine, published_release,
                                                  monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    assert client.get("/api/topic-practice/types?level=N5").status_code == 401
    assert client.get("/api/topic-practice/types?level=X9",
                      headers=auth(USER_A)).status_code == 422
    body = client.get("/api/topic-practice/types?level=N5",
                      headers=auth(USER_A)).text
    for banned in ("correct", "explanation", "answer"):
        assert banned not in body


@requires_db
def test_create_samples_whole_unit_pinned_to_release(pg_engine, published_release,
                                                     monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    r = create(client, USER_A)
    assert r.status_code == 201, r.text
    s = r.json()
    assert s["mode"] == "practice"
    assert [u["unit_id"] for u in s["units"]] == [CLOZE_UNIT]
    assert s["units"][0]["release_id"] == str(published_release)
    assert s["config"]["topic"] == {
        "kind": "topic", "level": "N5",
        "question_type_id": "grammar_cloze", "requested_count": 1,
        "selection": "smart"}
    assert "correct" not in r.text
    # the new session is the ordinary current practice session
    cur = client.get("/api/practice/sessions/current", headers=auth(USER_A))
    assert cur.json()["id"] == s["id"]


@requires_db
def test_create_validation_errors(pg_engine, published_release, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    over = create(client, USER_A, count=2)
    assert over.status_code == 422
    assert over.json()["detail"]["code"] == "count_exceeds_available"
    assert over.json()["detail"]["available_units"] == 1
    assert create(client, USER_A, qtype="reading_long").json()["detail"]["code"] \
        == "no_candidates"
    assert create(client, USER_A, level="N1").json()["detail"]["code"] \
        == "no_candidates"
    assert create(client, USER_A, count=0).status_code == 422
    assert create(client, USER_A, count=101).status_code == 422


@requires_db
def test_starting_another_topic_session_abandons_the_old_one_keeping_answers(
        pg_engine, published_release, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    first = create(client, USER_A).json()
    suid = first["units"][0]["id"]
    submit(client, USER_A, first["id"], suid, [(Q1, Q1 + "-o2"), (Q2, Q2 + "-o1")])
    other = create(client, USER_A, qtype="vocabulary_kanji_reading")  # no 409
    assert other.status_code == 201
    with pg_engine.connect() as conn:
        st = dict(conn.execute(sa.text(
            "SELECT id::text, state FROM study_sessions WHERE user_id=:u"),
            {"u": USER_A}).all())
        kept = conn.execute(sa.text(
            "SELECT count(*) FROM study_submitted_answers WHERE session_unit_id=:s"),
            {"s": suid}).scalar()
    assert st[first["id"]] == "abandoned"
    assert st[other.json()["id"]] == "in_progress"
    assert kept == 2  # formal answers of the old session survive
    # ...and still count as history for sampling
    assert types(client, USER_A)["grammar_cloze"]["new_units"] == 0


@requires_db
def test_history_only_from_formal_submissions(pg_engine, published_release,
                                              monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    s = create(client, USER_A).json()
    sid, suid = s["id"], s["units"][0]["id"]
    # a draft selection is not history
    client.put(f"/api/practice/sessions/{sid}/units/{suid}/drafts",
               json={"question_id": Q1, "chosen_option_id": Q1 + "-o2",
                     "expected_row_version": 0}, headers=auth(USER_A))
    assert types(client, USER_A)["grammar_cloze"]["new_units"] == 1
    # an all-skip formal submission still means the unit was practised
    submit(client, USER_A, sid, suid, [])
    assert types(client, USER_A)["grammar_cloze"]["new_units"] == 0
    # another account is unaffected
    assert types(client, USER_B)["grammar_cloze"]["new_units"] == 1


@requires_db
def test_quick_practice_submission_counts_as_history(pg_engine, published_release,
                                                     monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    q = client.post("/api/quick-practice/sessions", json={
        "release_id": str(published_release), "unit_id": SINGLE_UNIT},
        headers=auth(USER_A)).json()
    submit(client, USER_A, q["id"], q["units"][0]["id"], [(QS, QS + "-o3")])
    t = types(client, USER_A)
    assert t["vocabulary_kanji_reading"]["new_units"] == 0
    assert t["grammar_cloze"]["new_units"] == 1
    # quick and topic sessions never block each other
    assert create(client, USER_A, qtype="vocabulary_kanji_reading").status_code == 201
