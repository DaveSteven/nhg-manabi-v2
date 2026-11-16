"""Media sync tests: validate → atomic store → queryable mapping.

Covers the user-confirmed failure matrix: duplicate import (idempotent),
missing source, hash mismatch, corrupted store repair, undecodable audio,
failed retry that must not damage validated files, and path-shard layout.
Uses isolated test directories and synthetic media only; never touches
development staging content.
"""
import hashlib
import json
import os

import pytest
from sqlalchemy import text

from media_sample import TINY_MP3_BYTES, TINY_MP3_DURATION_MS, TINY_MP3_SHA256, TINY_PNG_BYTES

requires_db = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"),
    reason="DATABASE_URL not set; requires migrated PostgreSQL",
)

PNG_SHA = hashlib.sha256(TINY_PNG_BYTES).hexdigest()


def _make_source(tmp_path):
    """A Raw-style source root: one exam dir with resources.json + files."""
    exam = tmp_path / "raw" / "examA"
    res = exam / "resources" / "audio"
    res.mkdir(parents=True)
    (res / "a.mp3").write_bytes(TINY_MP3_BYTES)
    img = exam / "resources" / "img"
    img.mkdir(parents=True)
    (img / "b.png").write_bytes(TINY_PNG_BYTES)
    manifest = [
        {"id": "audio-1", "path": "resources/audio/a.mp3",
         "size": len(TINY_MP3_BYTES), "contentType": "audio/mpeg"},
        {"id": "img-1", "path": "resources/img/b.png",
         "size": len(TINY_PNG_BYTES), "contentType": "image/png"},
    ]
    (exam / "resources.json").write_text(json.dumps(manifest), encoding="utf-8")
    return exam


def _assets():
    return [
        {"record_type": "media_asset", "schema_version": "2.0.0",
         "id": "PKG-as001", "storage_key": "assets/PKG/aaa1.mp3",
         "mime_type": "audio/mpeg", "sha256": TINY_MP3_SHA256,
         "size_bytes": len(TINY_MP3_BYTES), "duration_ms": TINY_MP3_DURATION_MS,
         "availability": "verified"},
        {"record_type": "media_asset", "schema_version": "2.0.0",
         "id": "PKG-as002", "storage_key": "assets/PKG/bbbb.png",
         "mime_type": "image/png", "sha256": PNG_SHA,
         "size_bytes": len(TINY_PNG_BYTES), "duration_ms": None,
         "availability": "verified"},
    ]


def _row(engine, asset_id):
    with engine.connect() as conn:
        return conn.execute(text(
            "SELECT state, stored_sha256, stored_size_bytes, stored_mime_type,"
            " verified_duration_ms, source_path FROM media_storage"
            " WHERE asset_id = :a"), {"a": asset_id}).first()


def _clean(engine):
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM media_storage WHERE asset_id LIKE 'PKG-%'"))


@pytest.fixture()
def media_env(pg_engine, tmp_path, monkeypatch):
    from app.media_sync import build_source_index

    _clean(pg_engine)
    exam = _make_source(tmp_path)
    storage = tmp_path / "v2-media"
    index = build_source_index([tmp_path / "raw"])
    yield {"engine": pg_engine, "storage": storage, "index": index,
           "exam": exam}
    _clean(pg_engine)


def _sync(env, assets=None):
    from app.media_sync import sync_assets
    return sync_assets(env["engine"], assets if assets is not None else _assets(),
                       env["index"], env["storage"])


def _stored_file(env, sha, ext):
    return env["storage"] / sha[:2] / sha[2:4] / f"{sha}{ext}"


class TestMediaSync:
    @requires_db
    def test_happy_path_stores_and_records(self, media_env):
        result = _sync(media_env)
        assert result["stored"] == 2
        assert result["unavailable"] == 0

        audio = _row(media_env["engine"], "PKG-as001")
        assert audio.state == "stored"
        assert audio.stored_sha256 == TINY_MP3_SHA256
        assert audio.stored_size_bytes == len(TINY_MP3_BYTES)
        assert audio.stored_mime_type == "audio/mpeg"
        assert audio.verified_duration_ms == TINY_MP3_DURATION_MS
        assert audio.source_path.endswith("a.mp3")

        png = _row(media_env["engine"], "PKG-as002")
        assert png.state == "stored"
        assert png.verified_duration_ms is None

        assert _stored_file(media_env, TINY_MP3_SHA256, ".mp3").is_file()
        assert _stored_file(media_env, PNG_SHA, ".png").is_file()

    @requires_db
    def test_duplicate_import_is_idempotent(self, media_env):
        first = _sync(media_env)
        mtime = _stored_file(media_env, TINY_MP3_SHA256, ".mp3").stat().st_mtime_ns
        second = _sync(media_env)
        assert (first["stored"], first["unavailable"]) == (2, 0)
        assert (second["stored"], second["unavailable"]) == (2, 0)
        assert _stored_file(
            media_env, TINY_MP3_SHA256, ".mp3").stat().st_mtime_ns == mtime

    @requires_db
    def test_missing_source_marks_unavailable(self, media_env):
        assets = _assets()[:1]
        assets[0] = {**assets[0], "sha256": "f" * 64}  # hash of nothing local
        result = _sync(media_env, assets)
        assert result["stored"] == 0
        row = _row(media_env["engine"], "PKG-as001")
        assert row.state == "unavailable"
        assert row.stored_sha256 is None
        with engine_connect(media_env["engine"]) as conn:
            err = conn.execute(text(
                "SELECT last_error->>'reason' FROM media_storage"
                " WHERE asset_id = 'PKG-as001'")).scalar()
        assert err == "source_missing"

    @requires_db
    def test_size_mismatch_marks_unavailable(self, media_env):
        assets = [{**_assets()[0], "size_bytes": len(TINY_MP3_BYTES) + 1}]
        result = _sync(media_env, assets)
        assert result["stored"] == 0
        with engine_connect(media_env["engine"]) as conn:
            reason = conn.execute(text(
                "SELECT last_error->>'reason' FROM media_storage"
                " WHERE asset_id = 'PKG-as001'")).scalar()
        assert reason == "size_mismatch"

    @requires_db
    def test_undecodable_audio_marks_unavailable(self, media_env):
        from app.media_sync import SourceFile
        # ID3 magic bytes pass sniffing but ffprobe cannot read a duration.
        garbage = b"ID3" + b"\x00" * 12
        garbage_sha = hashlib.sha256(garbage).hexdigest()
        env = media_env
        bad_file = env["exam"] / "resources" / "audio" / "bad.mp3"
        bad_file.write_bytes(garbage)
        env["index"][garbage_sha] = SourceFile(
            path=bad_file,
            source_system="raw_local", source_path="resources/audio/bad.mp3",
            declared_size=len(garbage), declared_mime="audio/mpeg")
        assets = [{"record_type": "media_asset", "schema_version": "2.0.0",
                   "id": "PKG-bad", "storage_key": "assets/PKG/bad.mp3",
                   "mime_type": "audio/mpeg", "sha256": garbage_sha,
                   "size_bytes": len(garbage), "duration_ms": 1000,
                   "availability": "verified"}]
        result = _sync(env, assets)
        assert result["stored"] == 0
        with engine_connect(env["engine"]) as conn:
            reason = conn.execute(text(
                "SELECT last_error->>'reason' FROM media_storage"
                " WHERE asset_id = 'PKG-bad'")).scalar()
        assert reason == "audio_unplayable"

    @requires_db
    def test_corrupted_store_is_repaired(self, media_env):
        _sync(media_env)
        target = _stored_file(media_env, TINY_MP3_SHA256, ".mp3")
        target.write_bytes(b"corrupted!")  # simulate on-disk corruption
        result = _sync(media_env)
        assert result["stored"] == 2
        assert any("repairing" in w for w in result["warnings"])
        assert target.read_bytes() == TINY_MP3_BYTES

    @requires_db
    def test_retry_after_source_fix_does_not_break_valid_files(self, media_env):
        # First run: PNG missing from sources → unavailable; MP3 stored.
        index = {k: v for k, v in media_env["index"].items() if k != PNG_SHA}
        from app.media_sync import sync_assets
        partial = sync_assets(media_env["engine"], _assets(), index,
                              media_env["storage"])
        assert (partial["stored"], partial["unavailable"]) == (1, 1)
        assert _stored_file(media_env, TINY_MP3_SHA256, ".mp3").read_bytes() \
            == TINY_MP3_BYTES

        # Retry with the full index: PNG recovers, MP3 untouched.
        result = _sync(media_env)
        assert (result["stored"], result["unavailable"]) == (2, 0)
        assert _stored_file(media_env, TINY_MP3_SHA256, ".mp3").read_bytes() \
            == TINY_MP3_BYTES
        assert _stored_file(media_env, PNG_SHA, ".png").is_file()

    @requires_db
    def test_invalid_sha_record_is_reported_without_row(self, media_env):
        assets = [{"record_type": "media_asset", "schema_version": "2.0.0",
                   "id": "PKG-badsha", "storage_key": "assets/PKG/x.mp3",
                   "mime_type": "audio/mpeg", "sha256": "zz",
                   "size_bytes": 1, "duration_ms": None,
                   "availability": "verified"}]
        result = _sync(media_env, assets)
        assert result["unavailable"] == 1
        assert result["issues"][0]["reason"] == "invalid_hash"
        assert _row(media_env["engine"], "PKG-badsha") is None

    @requires_db
    def test_mime_mismatch_marks_unavailable(self, media_env):
        assets = [{**_assets()[1], "mime_type": "image/jpeg"}]
        result = _sync(media_env, assets)
        assert result["stored"] == 0
        with engine_connect(media_env["engine"]) as conn:
            reason = conn.execute(text(
                "SELECT last_error->>'reason' FROM media_storage"
                " WHERE asset_id = 'PKG-as002'")).scalar()
        assert reason == "mime_mismatch"


def engine_connect(engine):
    return engine.connect()
