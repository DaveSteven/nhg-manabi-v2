"""Media API tests: publish/association gating, Range serving, 404 uniformity.

The happy path uses a fixture variant whose cloze unit carries an audio
material referencing as001, walked through the full publish gate; the
media_storage row + stored file are prepared directly (sync itself is
covered by test_media_sync.py). All deny paths must be uniform 404.
"""
import os

import pytest
from sqlalchemy import text
from test_practice_sessions import requires_db  # same DATABASE_URL guard

from conftest import CLOZE_UNIT, EXAM_ID
from media_sample import TINY_MP3_BYTES

ASSET = "JLPTGO-N5-TEST-EX-as001"
ASSET_2 = "JLPTGO-N5-TEST-EX-as002"


def make_client(monkeypatch, pg_engine):
    monkeypatch.setenv(
        "DATABASE_URL", pg_engine.url.render_as_string(hide_password=False))
    from fastapi.testclient import TestClient
    from app.main import app
    return TestClient(app)


@pytest.fixture(autouse=True)
def clean_media_storage(pg_engine):
    """media_storage is not covered by clean_publish; wipe fixture rows."""
    with pg_engine.begin() as conn:
        conn.execute(text(
            "DELETE FROM media_storage WHERE asset_id LIKE"
            " 'JLPTGO-N5-TEST-EX-%'"))
    yield
    with pg_engine.begin() as conn:
        conn.execute(text(
            "DELETE FROM media_storage WHERE asset_id LIKE"
            " 'JLPTGO-N5-TEST-EX-%'"))


def _set_storage_root(monkeypatch, tmp_path):
    root = tmp_path / "v2-media"
    root.mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("MEDIA_STORAGE_DIR", str(root))
    return root


def _store_file(root, sha, mime_type, content):
    from app.api.media import _EXT_BY_MIME
    ext = _EXT_BY_MIME.get(mime_type, ".bin")
    path = root / sha[:2] / sha[2:4] / f"{sha}{ext}"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    return path


def _seed_storage(root, sha="b" * 64, mime_type="audio/mpeg",
                  content=None, asset_id=ASSET):
    """Mark an asset stored (media_assets row must exist) and place its
    content-addressed file."""
    from app.api.media import get_engine  # noqa: F401 (endpoint module import check)

    _store_file(root, sha, mime_type, content if content is not None
                else TINY_MP3_BYTES)


@pytest.fixture()
def published_with_audio(pg_engine, clean_publish):
    """Publish the fixture with an audio material referencing as001."""
    import tempfile
    from pathlib import Path

    from importer_fixture import make_provenance, make_records, write_zip
    from conftest import PACKAGE_ID
    from app.importer.reader import load_archive
    from app.importer.staging import stage_package
    from app.publisher import confirm_rights, promote_release, publish_package

    records = make_records()
    unit = next(u for u in records["units.jsonl"] if u["id"] == CLOZE_UNIT)
    unit["materials"].append({
        "id": f"{CLOZE_UNIT}-m-audio", "kind": "audio", "role": "primary",
        "language": "ja-JP", "content": None, "asset_id": ASSET,
        "cues": [{"index": 1, "start_ms": 0, "end_ms": 30_000, "text": {}}],
        "translated_from_material_id": None,
    })
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "audio-variant.zip")
        write_zip(records, make_provenance(), path)
        stage_package(pg_engine, load_archive(Path(path))[0])
    publish_package(pg_engine, PACKAGE_ID)
    with pg_engine.begin() as conn:
        conn.execute(text(
            "UPDATE release_answer_keys SET review_status = 'human_reviewed'"
            " WHERE release_id = (SELECT id FROM exam_releases"
            " WHERE exam_id = :e)"), {"e": EXAM_ID})
        conn.execute(text(
            "UPDATE media_assets SET availability = 'verified'"
            " WHERE id = :a"), {"a": ASSET})
    confirm_rights(pg_engine, EXAM_ID, reviewer_id="legal")
    with pg_engine.connect() as conn:
        release_id = conn.execute(text(
            "SELECT id FROM exam_releases WHERE exam_id = :e"),
            {"e": EXAM_ID}).scalar()
    promote_release(pg_engine, release_id, reviewer_id="reviewer-1")
    return release_id


def _seed_stored_asset(pg_engine, root, *, sha="b" * 64,
                       mime_type="audio/mpeg", asset_id=ASSET):
    """Insert/update the media_storage mapping + on-disk content-addressed
    file for a published release's asset."""
    from app.media_sync import storage_rel_path

    path = root / storage_rel_path(sha, mime_type)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(TINY_MP3_BYTES)
    with pg_engine.begin() as conn:
        conn.execute(text(
            "INSERT INTO media_storage (asset_id, state, stored_sha256,"
            " stored_size_bytes, stored_mime_type, rule_version)"
            " VALUES (:a, 'stored', :sha, :size, :mime, 'test')"
            " ON CONFLICT (asset_id) DO UPDATE SET state = 'stored',"
            " stored_sha256 = EXCLUDED.stored_sha256,"
            " stored_size_bytes = EXCLUDED.stored_size_bytes,"
            " stored_mime_type = EXCLUDED.stored_mime_type, last_error = NULL"),
            {"a": asset_id, "sha": sha, "size": len(TINY_MP3_BYTES),
             "mime": mime_type})


class TestMediaAPI:
    @requires_db
    def test_full_get_serves_stored_asset(self, pg_engine, published_with_audio,
                                          monkeypatch, tmp_path):
        root = _set_storage_root(monkeypatch, tmp_path)
        _seed_stored_asset(pg_engine, root)
        client = make_client(monkeypatch, pg_engine)

        resp = client.get(f"/api/releases/{published_with_audio}/assets/{ASSET}")
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("audio/mpeg")
        assert resp.headers["accept-ranges"] == "bytes"
        assert int(resp.headers["content-length"]) == len(TINY_MP3_BYTES)
        assert resp.content == TINY_MP3_BYTES
        assert "public" in resp.headers.get("cache-control", "")

        head = client.head(f"/api/releases/{published_with_audio}/assets/{ASSET}")
        assert head.status_code == 200
        assert head.headers["content-length"] == str(len(TINY_MP3_BYTES))
        assert head.content == b""

    @requires_db
    def test_range_requests_206_and_416(self, pg_engine, published_with_audio,
                                        monkeypatch, tmp_path):
        root = _set_storage_root(monkeypatch, tmp_path)
        _seed_stored_asset(pg_engine, root)
        client = make_client(monkeypatch, pg_engine)
        url = f"/api/releases/{published_with_audio}/assets/{ASSET}"
        size = len(TINY_MP3_BYTES)

        mid = client.get(url, headers={"Range": "bytes=100-199"})
        assert mid.status_code == 206
        assert mid.headers["content-range"] == f"bytes 100-199/{size}"
        assert mid.content == TINY_MP3_BYTES[100:200]

        tail = client.get(url, headers={"Range": "bytes=-50"})
        assert tail.status_code == 206
        assert tail.headers["content-range"] == f"bytes {size-50}-{size-1}/{size}"
        assert tail.content == TINY_MP3_BYTES[-50:]

        open_end = client.get(url, headers={"Range": "bytes=100-"})
        assert open_end.status_code == 206
        assert open_end.content == TINY_MP3_BYTES[100:]

        bad = client.get(url, headers={"Range": f"bytes={size}-"})
        assert bad.status_code == 416
        assert bad.headers["content-range"] == f"bytes */{size}"

        malformed = client.get(url, headers={"Range": "bytes=a-b"})
        assert malformed.status_code == 200  # malformed → ignored, full body

    @requires_db
    def test_draft_release_is_404(self, pg_engine, staged_and_published,
                                  monkeypatch, tmp_path):
        root = _set_storage_root(monkeypatch, tmp_path)
        _seed_stored_asset(pg_engine, root)
        client = make_client(monkeypatch, pg_engine)
        resp = client.get(
            f"/api/releases/{staged_and_published['release_id']}/assets/{ASSET}")
        assert resp.status_code == 404
        assert resp.json() == {"detail": "release not published"}

    @requires_db
    def test_unreferenced_asset_is_404(self, pg_engine, published_with_audio,
                                       monkeypatch, tmp_path):
        root = _set_storage_root(monkeypatch, tmp_path)
        # as002 is not part of this variant's package; insert its registry
        # row + a storage mapping to prove gating is by release association.
        sha = "c" * 64
        with pg_engine.begin() as conn:
            conn.execute(text(
                "INSERT INTO media_assets (id, sha256, storage_key, mime_type,"
                " size_bytes, availability) VALUES (:i, :sha, 'assets/x.mp3',"
                " 'audio/mpeg', 32, 'verified')"),
                {"i": ASSET_2, "sha": sha})
            conn.execute(text(
                "INSERT INTO media_storage (asset_id, state, stored_sha256,"
                " rule_version) VALUES (:i, 'stored', :sha, 'test')"),
                {"i": ASSET_2, "sha": sha})
        _store_file(root, sha, "audio/mpeg", b"x" * 32)
        client = make_client(monkeypatch, pg_engine)
        resp = client.get(f"/api/releases/{published_with_audio}/assets/{ASSET_2}")
        assert resp.status_code == 404
        assert resp.json() == {"detail": "asset unavailable"}

    @requires_db
    def test_missing_storage_row_is_404(self, pg_engine, published_with_audio,
                                        monkeypatch, tmp_path):
        _set_storage_root(monkeypatch, tmp_path)
        client = make_client(monkeypatch, pg_engine)
        resp = client.get(f"/api/releases/{published_with_audio}/assets/{ASSET}")
        assert resp.status_code == 404
        assert resp.json() == {"detail": "asset unavailable"}

    @requires_db
    def test_hash_mismatch_between_storage_and_registry_is_404(
            self, pg_engine, published_with_audio, monkeypatch, tmp_path):
        root = _set_storage_root(monkeypatch, tmp_path)
        _seed_stored_asset(pg_engine, root)
        wrong = "a" * 64
        with pg_engine.begin() as conn:
            conn.execute(text(
                "UPDATE media_storage SET stored_sha256 = :w WHERE asset_id = :a"),
                {"w": wrong, "a": ASSET})
        client = make_client(monkeypatch, pg_engine)
        resp = client.get(f"/api/releases/{published_with_audio}/assets/{ASSET}")
        assert resp.status_code == 404

    @requires_db
    def test_missing_file_on_disk_is_404(self, pg_engine, published_with_audio,
                                         monkeypatch, tmp_path):
        from app.media_sync import storage_rel_path
        root = _set_storage_root(monkeypatch, tmp_path)
        _seed_stored_asset(pg_engine, root)
        (root / storage_rel_path("b" * 64, "audio/mpeg")).unlink()
        client = make_client(monkeypatch, pg_engine)
        resp = client.get(f"/api/releases/{published_with_audio}/assets/{ASSET}")
        assert resp.status_code == 404

    @requires_db
    def test_unknown_release_and_asset_are_404(self, pg_engine,
                                               published_with_audio,
                                               monkeypatch, tmp_path):
        _set_storage_root(monkeypatch, tmp_path)
        client = make_client(monkeypatch, pg_engine)
        assert client.get(
            "/api/releases/00000000-0000-0000-0000-000000000000/assets/"
            f"{ASSET}").status_code == 404
        assert client.get(
            f"/api/releases/{published_with_audio}/assets/nope").status_code == 404

    @requires_db
    def test_non_current_published_release_still_serves(
            self, pg_engine, published_with_audio, monkeypatch, tmp_path):
        """Historical sessions pin their release; the endpoint checks
        release state only, never the exam_current_releases pointer."""
        root = _set_storage_root(monkeypatch, tmp_path)
        _seed_stored_asset(pg_engine, root)
        with pg_engine.begin() as conn:
            conn.execute(text(
                "DELETE FROM exam_current_releases WHERE exam_id = :e"),
                {"e": EXAM_ID})
        client = make_client(monkeypatch, pg_engine)
        resp = client.get(f"/api/releases/{published_with_audio}/assets/{ASSET}")
        assert resp.status_code == 200
        assert resp.content == TINY_MP3_BYTES
