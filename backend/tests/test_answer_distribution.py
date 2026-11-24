"""历年答案分布: aggregate-only, authenticated."""
import os

import pytest
import sqlalchemy as sa

from test_topic_practice import USER_A, auth, make_client  # noqa: F401

requires_db = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"), reason="DATABASE_URL not set")


@pytest.fixture(autouse=True)
def _study_isolation(clean_study):
    """Wipe the study domain around each test."""


@requires_db
def test_requires_login(pg_engine, published_release, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    assert client.get("/api/answer-distribution").status_code == 401


@requires_db
def test_counts_are_aggregate_and_match_keys(pg_engine, published_release,
                                             monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    r = client.get("/api/answer-distribution", headers=auth(USER_A))
    assert r.status_code == 200, r.text
    body = r.json()
    # fixture: 3 keyed questions in one N5 paper (2 cloze + 1 kanji reading)
    assert sum(c["count"] for c in body["counts"]) == 3
    by_type: dict[str, int] = {}
    for c in body["counts"]:
        assert c["level"] == "N5"
        by_type[c["question_type_id"]] = by_type.get(c["question_type_id"], 0) + c["count"]
    assert by_type == {"grammar_cloze": 2, "vocabulary_kanji_reading": 1}
    assert [t["question_type_id"] for t in body["types"]] == [
        "vocabulary_kanji_reading", "grammar_cloze"]  # paper order
    # nothing identifying leaks: only these keys
    assert set(body["counts"][0]) == {"level", "question_type_id", "position", "count"}
    with pg_engine.connect() as conn:
        expect = conn.execute(sa.text(
            "SELECT o.position FROM release_answer_keys k JOIN release_options o"
            " ON o.release_id=k.release_id AND o.question_id=k.question_id"
            " AND o.option_id=k.correct_option_id")).scalars().all()
    got = sorted(c["position"] for c in body["counts"] for _ in range(c["count"]))
    assert got == sorted(expect)
