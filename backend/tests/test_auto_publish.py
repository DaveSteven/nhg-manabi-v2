"""ADR-0010: import auto-publishes by default; the gated path is intact.

Auto-publish skips the review/rights/media gates but records an
``auto_published`` decision whose note states exactly what was unverified,
so the audit trail never claims review that did not happen.
"""
import json
import os
import tempfile
from pathlib import Path

import pytest
from sqlalchemy import text

from conftest import EXAM_ID, PACKAGE_ID
from test_practice_sessions import requires_db


def _zip(tmp) -> str:
    from importer_fixture import make_provenance, make_records, write_zip
    path = os.path.join(tmp, "pkg.zip")
    write_zip(make_records(), make_provenance(), path)
    return path


def _stage(pg_engine, tmp):
    from app.importer.reader import load_archive
    from app.importer.staging import stage_package
    stage_package(pg_engine, load_archive(Path(_zip(tmp)))[0])


@requires_db
def test_auto_publish_publishes_without_review_and_records_what_was_skipped(
        pg_engine, clean_publish):
    from app.publisher import auto_publish_package
    with tempfile.TemporaryDirectory() as tmp:
        _stage(pg_engine, tmp)
    out = auto_publish_package(pg_engine, PACKAGE_ID, reviewer_id="system:auto-publish")
    assert out["state"] == "published" and out["idempotent"] is False
    with pg_engine.connect() as conn:
        assert conn.execute(text(
            "SELECT release_id::text FROM exam_current_releases WHERE exam_id=:e"),
            {"e": EXAM_ID}).scalar() == out["release_id"]
        keys = conn.execute(text(
            "SELECT DISTINCT review_status FROM release_answer_keys"
            " WHERE release_id=:r"), {"r": out["release_id"]}).scalars().all()
        dec = conn.execute(text(
            "SELECT decision, reviewer_id, notes FROM publication_decisions"
            " WHERE exam_id=:e ORDER BY decided_at DESC LIMIT 1"),
            {"e": EXAM_ID}).first()
    assert keys == ["unverified"], "status stays honest: nothing was verified"
    assert dec.decision == "auto_published" and dec.reviewer_id == "system:auto-publish"
    note = json.loads(dec.notes)
    assert note["policy"] == "auto" and note["unverified_answer_keys"] == 3
    assert note["rights_confirmed"] is False


@requires_db
def test_auto_publish_is_idempotent(pg_engine, clean_publish):
    from app.publisher import auto_publish_package
    with tempfile.TemporaryDirectory() as tmp:
        _stage(pg_engine, tmp)
    a = auto_publish_package(pg_engine, PACKAGE_ID, reviewer_id="system:auto-publish")
    b = auto_publish_package(pg_engine, PACKAGE_ID, reviewer_id="system:auto-publish")
    assert b["release_id"] == a["release_id"] and b["idempotent"] is True
    with pg_engine.connect() as conn:
        assert conn.execute(text(
            "SELECT count(*) FROM publication_decisions WHERE exam_id=:e"
            " AND decision='auto_published'"), {"e": EXAM_ID}).scalar() == 1


@requires_db
def test_gated_promote_still_refuses_unverified(pg_engine, clean_publish):
    """The review gates are intact for the gated path."""
    from app.publisher import PublishGateError, promote_release, publish_package
    with tempfile.TemporaryDirectory() as tmp:
        _stage(pg_engine, tmp)
    rid = publish_package(pg_engine, PACKAGE_ID)["release_id"]
    with pytest.raises(PublishGateError):
        promote_release(pg_engine, rid, reviewer_id="x")


@requires_db
def test_importer_cli_publishes_by_default(pg_engine, clean_publish, monkeypatch, capsys):
    monkeypatch.setenv("DATABASE_URL", pg_engine.url.render_as_string(hide_password=False))
    monkeypatch.delenv("PUBLISH_POLICY", raising=False)
    from app.importer import __main__ as cli
    with tempfile.TemporaryDirectory() as tmp:
        assert cli.main([_zip(tmp)]) == 0
    with pg_engine.connect() as conn:
        assert conn.execute(text(
            "SELECT count(*) FROM exam_current_releases WHERE exam_id=:e"),
            {"e": EXAM_ID}).scalar() == 1


@requires_db
@pytest.mark.parametrize("mode", ["flag", "env"])
def test_importer_cli_can_stage_only(pg_engine, clean_publish, monkeypatch, mode):
    monkeypatch.setenv("DATABASE_URL", pg_engine.url.render_as_string(hide_password=False))
    if mode == "env":
        monkeypatch.setenv("PUBLISH_POLICY", "gated")
    from app.importer import __main__ as cli
    with tempfile.TemporaryDirectory() as tmp:
        argv = [_zip(tmp)] + (["--no-publish"] if mode == "flag" else [])
        assert cli.main(argv) == 0
    with pg_engine.connect() as conn:
        assert conn.execute(text(
            "SELECT count(*) FROM exam_current_releases WHERE exam_id=:e"),
            {"e": EXAM_ID}).scalar() == 0
