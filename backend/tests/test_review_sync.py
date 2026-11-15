"""Agent review-result sync tests (lightweight review workflow).

Covers: batch application, idempotent replay, stale-hash interception,
illegal-option interception, revision conflict, human conflict, promote gate
with agent_verified, unit blocking, published-release immutability.

Runs against the isolated test database (conftest.py).
"""
import json
import os

import pytest

from conftest import CLOZE_UNIT, EXAM_ID, PACKAGE_ID, SINGLE_UNIT

requires_db = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"),
    reason="DATABASE_URL not set; requires migrated PostgreSQL",
)

Q1 = "JLPTGO-N5-TEST-EX-ly-01-u01-q01"  # correct option: ...-o2
Q2 = "JLPTGO-N5-TEST-EX-ly-01-u01-q02"  # correct option: ...-o1
Q3 = "JLPTGO-N5-TEST-EX-ly-02-u01-q01"  # correct option: ...-o3

JOB = "review-JLPTGO-N5-TEST-EX-r1-batch1"
RUN = "run-001"


def _unit_result(engine, unit_id, questions, status="pass", job_id=JOB,
                 run_id=RUN, tamper_hash=False, checked_at="2026-11-15T12:00:00Z"):
    from app.review_sync import build_review_input
    inp = build_review_input(engine, PACKAGE_ID, unit_id)
    return {
        "contract_version": "2.0",
        "job_id": job_id,
        "unit_id": unit_id,
        "content_hash": ("deadbeef" if tamper_hash else inp["content_hash"]),
        "review_run_id": run_id,
        "agent": {"model": "test-agent", "prompt_version": "qa-test"},
        "status": status,
        "questions": questions,
        "checked_at": checked_at,
    }


def _pass(qid, option=None):
    return {"question_id": qid, "answer": "pass",
            "independent_answer_option_id": option, "suggestions": []}


def _key_status(pg_engine, release_id, qid):
    from sqlalchemy import text
    with pg_engine.connect() as conn:
        return conn.execute(text(
            "SELECT review_status FROM release_answer_keys"
            " WHERE release_id = :r AND question_id = :q"),
            {"r": release_id, "q": qid}).scalar()


@requires_db
def test_sync_applies_verified_keys_and_is_idempotent(pg_engine, staged_and_published):
    from app.review_sync import sync_agent_reviews
    release_id = staged_and_published["release_id"]

    result = _unit_result(pg_engine, CLOZE_UNIT, [_pass(Q1), _pass(Q2)])
    report = sync_agent_reviews(pg_engine, PACKAGE_ID, [result])
    assert report["applied_count"] == 2 and report["intercepted"] == []
    assert _key_status(pg_engine, release_id, Q1) == "agent_verified"
    assert _key_status(pg_engine, release_id, Q2) == "agent_verified"
    assert _key_status(pg_engine, release_id, Q3) == "unverified"

    # Replay the same batch: nothing new, no duplicates.
    report2 = sync_agent_reviews(pg_engine, PACKAGE_ID, [result])
    assert report2["applied_count"] == 0
    assert report2["already_present_count"] == 2
    from sqlalchemy import text
    with pg_engine.connect() as conn:
        rows = conn.execute(text(
            "SELECT count(*) FROM content_reviews WHERE reviewer_type = 'agent'"
            " AND record_type = 'answer_key'")).scalar()
    assert rows == 2


@requires_db
def test_stale_content_hash_is_intercepted(pg_engine, staged_and_published):
    from app.review_sync import sync_agent_reviews
    result = _unit_result(pg_engine, CLOZE_UNIT, [_pass(Q1)], tamper_hash=True)
    report = sync_agent_reviews(pg_engine, PACKAGE_ID, [result])
    assert report["applied_count"] == 0
    assert report["intercepted"][0]["reason"] == "stale_content_hash"
    assert _key_status(pg_engine, staged_and_published["release_id"], Q1) == "unverified"


@requires_db
def test_illegal_option_is_intercepted(pg_engine, staged_and_published):
    from app.review_sync import sync_agent_reviews
    result = _unit_result(pg_engine, CLOZE_UNIT,
                          [_pass(Q1, option="nonexistent-option")])
    report = sync_agent_reviews(pg_engine, PACKAGE_ID, [result])
    assert report["applied_count"] == 0
    assert report["intercepted"][0]["reason"] == "illegal_option"
    assert _key_status(pg_engine, staged_and_published["release_id"], Q1) == "unverified"


@requires_db
def test_proposed_different_option_is_not_a_verification(pg_engine, staged_and_published):
    from app.review_sync import sync_agent_reviews
    result = _unit_result(pg_engine, CLOZE_UNIT, [_pass(Q1, option=Q1.replace("q01", "q01-o1"))])
    report = sync_agent_reviews(pg_engine, PACKAGE_ID, [result])
    assert report["applied_count"] == 0
    assert _key_status(pg_engine, staged_and_published["release_id"], Q1) == "unverified"
    from sqlalchemy import text
    with pg_engine.connect() as conn:
        evidence = conn.execute(text(
            "SELECT evidence FROM content_reviews WHERE record_type = 'answer_key'"
            " AND canonical_id = :q"), {"q": Q1}).scalar()
    assert evidence["proposed_option"].endswith("-o1")


@requires_db
def test_revision_conflict_is_intercepted(pg_engine, staged_and_published):
    from app.review_sync import sync_agent_reviews
    result = _unit_result(pg_engine, CLOZE_UNIT,
                          [{**_pass(Q1), "expected_revision": 99}])
    report = sync_agent_reviews(pg_engine, PACKAGE_ID, [result])
    assert report["applied_count"] == 0
    assert report["intercepted"][0]["reason"] == "revision_conflict"


@requires_db
def test_human_disputed_conflicts_with_agent_pass(pg_engine, staged_and_published):
    import uuid as uuid_mod

    from app.review_sync import build_review_input, sync_agent_reviews
    binding = build_review_input(pg_engine, PACKAGE_ID, CLOZE_UNIT)["content_hash"]
    from sqlalchemy import text
    with pg_engine.begin() as conn:
        conn.execute(text(
            "INSERT INTO content_reviews (id, record_type, canonical_id,"
            " content_hash, reviewer_type, reviewer_id, review_status, evidence,"
            " checked_at) VALUES (:id, 'answer_key', :cid, :chash, 'human',"
            " 'human-1', 'disputed', '{}'::jsonb, now())"),
            {"id": uuid_mod.uuid4(), "cid": Q1, "chash": binding})
    result = _unit_result(pg_engine, CLOZE_UNIT, [_pass(Q1)])
    report = sync_agent_reviews(pg_engine, PACKAGE_ID, [result])
    assert report["applied_count"] == 0
    assert any(i["reason"] == "human_conflict" for i in report["intercepted"])


@requires_db
def test_full_verified_batch_passes_promote(pg_engine, staged_and_published):
    from sqlalchemy import text
    from app.publisher import confirm_rights, promote_release
    from app.review_sync import sync_agent_reviews

    results = [
        _unit_result(pg_engine, CLOZE_UNIT, [_pass(Q1), _pass(Q2)]),
        _unit_result(pg_engine, SINGLE_UNIT, [_pass(Q3)]),
    ]
    report = sync_agent_reviews(pg_engine, PACKAGE_ID, results)
    assert report["applied_count"] == 3

    with pg_engine.begin() as conn:
        conn.execute(text(
            "UPDATE media_assets SET availability = 'verified'"
            " WHERE id = 'JLPTGO-N5-TEST-EX-as001'"))
    confirm_rights(pg_engine, EXAM_ID, reviewer_id="legal")
    result = promote_release(pg_engine, staged_and_published["release_id"],
                             reviewer_id="reviewer-1")
    assert result["state"] == "published"


@requires_db
def test_agent_blocked_unit_stops_promotion(pg_engine, staged_and_published):
    from sqlalchemy import text
    from app.publisher import PublishGateError, confirm_rights, promote_release
    from app.review_sync import sync_agent_reviews

    sync_agent_reviews(pg_engine, PACKAGE_ID, [
        _unit_result(pg_engine, CLOZE_UNIT, [_pass(Q1), _pass(Q2)]),
        _unit_result(pg_engine, SINGLE_UNIT, [_pass(Q3)]),
    ])
    # One unit later flagged needs_review by a different review run.
    sync_agent_reviews(pg_engine, PACKAGE_ID, [
        _unit_result(pg_engine, SINGLE_UNIT, [], status="needs_review",
                     job_id="review-batch2", run_id="run-002",
                     checked_at="2026-11-15T13:00:00Z"),
    ])
    with pg_engine.begin() as conn:
        conn.execute(text(
            "UPDATE media_assets SET availability = 'verified'"
            " WHERE id = 'JLPTGO-N5-TEST-EX-as001'"))
    confirm_rights(pg_engine, EXAM_ID, reviewer_id="legal")
    with pytest.raises(PublishGateError, match="flagged needs_review/blocked"):
        promote_release(pg_engine, staged_and_published["release_id"],
                        reviewer_id="reviewer-1")


@requires_db
def test_published_release_not_mutated_by_agent(pg_engine, staged_and_published):
    from sqlalchemy import text
    from app.publisher import confirm_rights, promote_release
    from app.review_sync import sync_agent_reviews

    # Verify everything, publish, then knock one key back to unverified to
    # simulate a release published before this key's review existed.
    sync_agent_reviews(pg_engine, PACKAGE_ID, [
        _unit_result(pg_engine, CLOZE_UNIT, [_pass(Q1), _pass(Q2)]),
        _unit_result(pg_engine, SINGLE_UNIT, [_pass(Q3)]),
    ])
    with pg_engine.begin() as conn:
        conn.execute(text(
            "UPDATE media_assets SET availability = 'verified'"
            " WHERE id = 'JLPTGO-N5-TEST-EX-as001'"))
    confirm_rights(pg_engine, EXAM_ID, reviewer_id="legal")
    release_id = staged_and_published["release_id"]
    promote_release(pg_engine, release_id, reviewer_id="reviewer-1")
    with pg_engine.begin() as conn:
        conn.execute(text(
            "UPDATE release_answer_keys SET review_status = 'unverified'"
            " WHERE release_id = :r AND question_id = :q"), {"r": release_id, "q": Q3})

    # A new agent batch must NOT touch the published snapshot rows.
    report = sync_agent_reviews(pg_engine, PACKAGE_ID, [
        _unit_result(pg_engine, SINGLE_UNIT, [_pass(Q3)],
                     job_id="review-batch3", run_id="run-003"),
    ])
    assert report["applied_count"] == 1  # evidence recorded
    assert report["release_state"] == "published"
    assert _key_status(pg_engine, release_id, Q3) == "unverified"
