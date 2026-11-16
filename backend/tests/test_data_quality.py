"""Data-quality record sync tests (M1.6 section 二).

Covers: validator findings → content_issues with content-hash + rule-version
binding; idempotent re-sync (no duplicate rows); query by unit / severity /
code; warning vs blocking distinction; unresolved blocking issues refuse
promotion; revalidation after a content fix resolves the stale finding.
The N4 confirmed cue-overrun pattern is exercised through the same fixture
(replicating cue_over_duration on a unit whose last cue exceeds verified
audio).
"""
import os

import pytest
from sqlalchemy import text

from conftest import CLOZE_UNIT, EXAM_ID, PACKAGE_ID, SINGLE_UNIT
from fixture_variants import CLOZE_UNIT as DQ_UNIT, stage_variant

requires_db = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"),
    reason="DATABASE_URL not set; requires migrated PostgreSQL",
)

Q1 = "JLPTGO-N5-TEST-EX-ly-01-u01-q01"
Q2 = "JLPTGO-N5-TEST-EX-ly-01-u01-q02"
Q3 = "JLPTGO-N5-TEST-EX-ly-02-u01-q01"


def _count(pg_engine, code=None, status=None):
    sql = "SELECT count(*) FROM content_issues WHERE 1=1"
    params = {}
    if code:
        sql += " AND issue_code = :c"
        params["c"] = code
    if status:
        sql += " AND status = :s"
        params["s"] = status
    with pg_engine.connect() as conn:
        return conn.execute(text(sql), params).scalar()


@pytest.fixture()
def staged_variant_with_cue_anomaly(pg_engine, clean_publish):
    stage_variant(pg_engine, cue_anomaly=True)
    from app.publisher import publish_package
    return publish_package(pg_engine, PACKAGE_ID)


@requires_db
def test_sync_idempotent_and_queryable_by_unit_severity_code(
        pg_engine, staged_variant_with_cue_anomaly):
    from app.data_quality import query_issues, sync_data_quality

    r1 = sync_data_quality(pg_engine, PACKAGE_ID)
    codes = {c["code"] for c in r1["created"]}
    assert "cue_over_duration" in codes and "cue_gap_large" in codes
    n_after_first = _count(pg_engine)

    # Re-sync: nothing new, nothing duplicated.
    r2 = sync_data_quality(pg_engine, PACKAGE_ID)
    assert r2["created_count"] == 0 and r2["reseen_count"] == r1["created_count"]
    assert _count(pg_engine) == n_after_first

    # Severity policy: overrun is blocking, large gap is warning.
    by_unit = query_issues(pg_engine, unit_id=DQ_UNIT)
    assert {row["issue_code"] for row in by_unit} >= {"cue_over_duration",
                                                "cue_gap_large"}
    sev = {row["issue_code"]: row["severity"] for row in by_unit}
    assert sev["cue_over_duration"] == "blocking"
    assert sev["cue_gap_large"] == "warning"
    # Every record is bound to the staged content hash and rule version.
    from app.publisher import _load_staged_package
    staged_hash, _ = _load_staged_package(pg_engine, PACKAGE_ID)
    assert all(row["content_hash"] == staged_hash for row in by_unit)
    assert all(row["rule_version"] == "dq-rules-1.0.0" for row in by_unit)

    # Query by code and severity.
    assert {r["issue_code"] for r in query_issues(pg_engine, code="cue_over_duration")} \
        == {"cue_over_duration"}
    blocking = query_issues(pg_engine, severity="blocking")
    assert blocking and all(r["severity"] == "blocking" for r in blocking)
    assert not query_issues(pg_engine, unit_id=DQ_UNIT, severity="blocking",
                            code="cue_gap_large")


@requires_db
def test_blocking_issue_refuses_promote_and_revalidation_resolves(
        pg_engine, staged_variant_with_cue_anomaly):
    from app.data_quality import sync_data_quality
    from app.publisher import PublishGateError, confirm_rights, promote_release
    from app.review_sync import sync_agent_reviews

    sync_data_quality(pg_engine, PACKAGE_ID)

    def _verify_everything(applied, already_present=0):
        report = sync_agent_reviews(pg_engine, PACKAGE_ID, [
            {"contract_version": "2.0", "job_id": "dq-job", "unit_id": CLOZE_UNIT,
             "content_hash": _unit_hash(pg_engine, CLOZE_UNIT),
             "review_run_id": "dq-run-1",
             "agent": {"model": "test-agent"}, "status": "pass",
             "questions": [
                 {"question_id": Q1, "answer": "pass",
                  "independent_answer_option_id": None},
                 {"question_id": Q2, "answer": "pass",
                  "independent_answer_option_id": None}],
             "checked_at": "2026-11-16T08:00:00Z"},
            {"contract_version": "2.0", "job_id": "dq-job", "unit_id": SINGLE_UNIT,
             "content_hash": _unit_hash(pg_engine, SINGLE_UNIT),
             "review_run_id": "dq-run-1",
             "agent": {"model": "test-agent"}, "status": "pass",
             "questions": [{"question_id": Q3, "answer": "pass",
                            "independent_answer_option_id": None}],
             "checked_at": "2026-11-16T08:00:00Z"},
        ])
        assert report["applied_count"] == applied, report["intercepted"]
        assert report["already_present_count"] == already_present

    _verify_everything(applied=3)
    with pg_engine.begin() as conn:
        conn.execute(text("UPDATE media_assets SET availability = 'verified'"
                          " WHERE id = 'JLPTGO-N5-TEST-EX-as001'"))
    confirm_rights(pg_engine, EXAM_ID, reviewer_id="legal")

    # Even with every answer verified, the open blocking cue_over_duration
    # finding on this content hash refuses promotion.
    release_id = staged_variant_with_cue_anomaly["release_id"]
    with pytest.raises(PublishGateError, match="unresolved blocking issue"):
        promote_release(pg_engine, release_id, reviewer_id="reviewer-1")

    # Fix the content: re-stage a corrected variant under a new content hash,
    # re-run the sync — the stale finding resolves, bound to the new hash.
    stage_variant(pg_engine, cue_anomaly=False)
    r3 = sync_data_quality(pg_engine, PACKAGE_ID)
    assert r3["resolved_count"] >= 1
    assert {r["code"] for r in r3["resolved"]} >= {"cue_over_duration",
                                                   "cue_gap_large"}
    from app.publisher import _load_staged_package, publish_package
    new_hash, _ = _load_staged_package(pg_engine, PACKAGE_ID)
    with pg_engine.connect() as conn:
        row = conn.execute(text(
            "SELECT status, resolved_content_hash, resolution_evidence"
            " FROM content_issues WHERE issue_code = 'cue_over_duration'"
            " AND canonical_id = :u"), {"u": DQ_UNIT}).first()
    assert row.status == "resolved"
    assert row.resolved_content_hash == new_hash
    assert row.resolution_evidence["resolved_by"] == "revalidation"
    assert row.resolution_evidence["finding"]["original_content_hash"] != new_hash

    # The new candidate promotes (with the re-review + gates satisfied).
    new_release = publish_package(pg_engine, PACKAGE_ID)
    # Q1/Q2 re-verified at the new hash; Q3's unit is unchanged so its
    # earlier verdict still binds (dedup, not a new verification) — and the
    # new release inherited it at publish time.
    _verify_everything(applied=2, already_present=1)
    with pg_engine.begin() as conn:
        conn.execute(text("UPDATE media_assets SET availability = 'verified'"
                          " WHERE id = 'JLPTGO-N5-TEST-EX-as001'"))
    result = promote_release(pg_engine, new_release["release_id"],
                             reviewer_id="reviewer-1")
    assert result["state"] == "published"


@requires_db
def test_issue_history_preserved_after_resolution(pg_engine,
                                                  staged_variant_with_cue_anomaly):
    from app.data_quality import sync_data_quality
    from app.review_state import resolve_issue_engine

    sync_data_quality(pg_engine, PACKAGE_ID)
    from app.data_quality import query_issues
    issue = query_issues(pg_engine, unit_id=DQ_UNIT, code="cue_over_duration")[0]

    out = resolve_issue_engine(
        pg_engine, issue["id"], reviewer_id="human-7",
        content_hash=issue["content_hash"],
        evidence={"method": "manual re-listen + cue re-alignment confirmed"})
    assert out["status"] == "resolved"
    with pytest.raises(ValueError, match="already resolved"):
        resolve_issue_engine(pg_engine, issue["id"], reviewer_id="human-7",
                             content_hash=issue["content_hash"], evidence={})
    # Original record stays queryable for traceability.
    resolved = query_issues(pg_engine, unit_id=DQ_UNIT, code="cue_over_duration",
                            status="resolved")
    assert len(resolved) == 1 and resolved[0]["id"] == issue["id"]
    assert resolved[0]["resolved_by"] == "human-7"


def _unit_hash(pg_engine, unit_id):
    from app.review_sync import build_review_input
    return build_review_input(pg_engine, PACKAGE_ID, unit_id)["content_hash"]
