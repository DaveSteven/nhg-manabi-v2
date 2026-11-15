"""Importer tests: hashing, validation, staging idempotency, rollback.

DB-backed tests require DATABASE_URL pointing at a migrated PostgreSQL and
are skipped otherwise (same convention as test_constraints_pg.py).
"""
import copy
import json
import os

import pytest

from app.importer.errors import ChecksumError, PackageReadError, StagingError, ValidationError
from app.importer.hashing import compute_content_hash
from app.importer.reader import load_archive
from app.importer.validator import validate_package
from importer_fixture import build_manifest, make_provenance, make_records, write_zip

DATABASE_URL = os.environ.get("DATABASE_URL")
requires_db = pytest.mark.skipif(
    not DATABASE_URL, reason="DATABASE_URL not set; requires migrated PostgreSQL"
)


# ---------------------------------------------------------------- hashing ----

def test_content_hash_is_key_order_and_volatile_field_independent():
    recs = make_records()
    a = compute_content_hash(recs)
    reordered = copy.deepcopy(recs)
    reordered["exam.json"][0] = dict(
        reversed(list(reordered["exam.json"][0].items())))
    assert compute_content_hash(reordered) == a
    with_generated = copy.deepcopy(recs)
    with_generated["exam.json"][0]["generated_at"] = "2030-01-01T00:00:00Z"
    assert compute_content_hash(with_generated) == a


def test_content_hash_changes_when_content_changes():
    recs = make_records()
    a = compute_content_hash(recs)
    recs["questions.jsonl"][0]["printed_number"] = "31番"
    assert compute_content_hash(recs) != a


# ------------------------------------------------------------- validation ----

def _write_and_load(tmp_path, records, provenance):
    path = tmp_path / "pkg.zip"
    write_zip(records, provenance, path)
    packages = load_archive(path)
    assert len(packages) == 1
    return packages[0]


def test_reader_loads_directory_packages(tmp_path):
    records = make_records()
    provenance = make_provenance()
    write_zip(records, provenance, tmp_path / "pkg.zip")
    # Rebuild the same package as a plain directory (not a zip).
    import zipfile
    pkg_dir = tmp_path / "pkgdir"
    with zipfile.ZipFile(tmp_path / "pkg.zip") as z:
        for item in z.infolist():
            if item.filename.endswith("/"):
                continue
            target = pkg_dir / item.filename
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(z.read(item.filename))
    packages = load_archive(pkg_dir)
    assert len(packages) == 1
    assert packages[0].package_id == "JLPTGO-N5-TEST-EX-r1"
    assert len(packages[0].records["questions.jsonl"]) == 3


def test_valid_fixture_package_passes_validation(tmp_path):
    package = _write_and_load(tmp_path, make_records(), make_provenance())
    vr = validate_package(package)
    assert vr.errors == [], [e.as_dict() for e in vr.errors]
    assert vr.counts == {
        "exam": 1, "sections": 2, "layers": 2, "question_types": 2,
        "units": 2, "questions": 3, "answer_keys": 3, "explanations": 1,
        "assets": 1, "source_mappings": 2,
    }


def test_reader_rejects_tampered_file(tmp_path):
    records = make_records()
    provenance = make_provenance()
    path = tmp_path / "pkg.zip"
    write_zip(records, provenance, path)
    # Rebuild zip with modified content but original manifest checksums.
    import hashlib
    import zipfile
    tampered = tmp_path / "tampered.zip"
    with zipfile.ZipFile(path) as src, zipfile.ZipFile(tampered, "w") as dst:
        for item in src.infolist():
            data = src.read(item.filename)
            if item.filename.endswith("questions.jsonl"):
                recs = [json.loads(l) for l in data.decode().splitlines() if l.strip()]
                recs[0]["printed_number"] = "99"
                data = ("\n".join(json.dumps(r, ensure_ascii=False) for r in recs) + "\n").encode()
            dst.writestr(item.filename, data)
    with pytest.raises(ChecksumError, match="questions.jsonl"):
        load_archive(tampered)


def test_reader_rejects_wrong_schema_version(tmp_path):
    records = make_records()
    records["exam.json"][0]["schema_version"] = "1.0.0"
    path = tmp_path / "pkg.zip"
    write_zip(records, make_provenance(), path)
    with pytest.raises(PackageReadError, match="schema_version"):
        load_archive(path)


def test_manifest_count_mismatch_rejected(tmp_path):
    records = make_records()
    provenance = make_provenance()
    path = tmp_path / "pkg.zip"
    write_zip(records, provenance, path)
    import zipfile
    bad_counts = tmp_path / "badcounts.zip"
    with zipfile.ZipFile(path) as src, zipfile.ZipFile(bad_counts, "w") as dst:
        for item in src.infolist():
            data = src.read(item.filename)
            if item.filename.endswith("manifest.json"):
                m = json.loads(data)
                m["counts"]["questions"] = 999
                data = json.dumps(m).encode()
            dst.writestr(item.filename, data)
    with pytest.raises(PackageReadError, match="counts.questions"):
        load_archive(bad_counts)


def _pop_two_options(r):
    r["questions.jsonl"][0]["options"].pop()
    r["questions.jsonl"][0]["options"].pop()


@pytest.mark.parametrize("mutation,code", [
    (lambda r: r["questions.jsonl"].append(copy.deepcopy(r["questions.jsonl"][0])), "duplicate_id"),
    (lambda r: r["answer_keys.private.jsonl"][0].__setitem__(
        "correct_option_ids", ["JLPTGO-N5-TEST-EX-ly-02-u01-q01-o1"]), "ak_option_ref"),
    (lambda r: r["units.jsonl"][0].__setitem__("kind", "single"), "unit_single_count"),
    (lambda r: r["layers.jsonl"][0].__setitem__("section", "reading"), "fk_layer_section"),
    (_pop_two_options, "options_count"),
    (lambda r: r["questions.jsonl"][2].__setitem__("printed_number", 1), "printed_number"),
    (lambda r: r["sections.jsonl"][1].__setitem__("position", 1), "position_duplicate"),
    (lambda r: r["questions.jsonl"][0].__setitem__(
        "slot_id", "JLPTGO-N5-TEST-EX-ly-01-u01-s09"), "slot_binding"),
])
def test_structural_violations_are_errors(tmp_path, mutation, code):
    records = make_records()
    mutation(records)
    package = _write_and_load(tmp_path, records, make_provenance())
    vr = validate_package(package)
    assert vr.errors, f"expected at least one '{code}' error"
    assert any(i.code == code for i in vr.errors), \
        [i.as_dict() for i in vr.errors]


def test_conversion_needs_review_is_warning_not_error(tmp_path):
    records = make_records()
    records["units.jsonl"][1]["conversion_status"] = "needs_review"
    package = _write_and_load(tmp_path, records, make_provenance())
    vr = validate_package(package)
    assert not vr.errors
    assert any(i.code == "unit_conversion" for i in vr.warnings)


# ---------------------------------------------------------------- staging ----

@pytest.fixture()
def pg_engine():
    from sqlalchemy import create_engine
    return create_engine(DATABASE_URL)


@pytest.fixture()
def clean_staging(pg_engine):
    from sqlalchemy import text
    with pg_engine.begin() as conn:
        conn.execute(text("DELETE FROM import_records"))
        conn.execute(text("DELETE FROM import_jobs"))
        conn.execute(text("DELETE FROM source_mappings WHERE source_system = 'test'"))
    yield
    with pg_engine.begin() as conn:
        conn.execute(text("DELETE FROM import_records"))
        conn.execute(text("DELETE FROM import_jobs"))
        conn.execute(text("DELETE FROM source_mappings WHERE source_system = 'test'"))


@requires_db
def test_stage_writes_staging_only_and_is_idempotent(tmp_path, pg_engine, clean_staging):
    from sqlalchemy import text
    path = tmp_path / "pkg.zip"
    write_zip(make_records(), make_provenance(), path)
    package = load_archive(path)[0]
    from app.importer.staging import stage_package
    result = stage_package(pg_engine, package)
    assert not result.idempotent and result.state == "staged"

    with pg_engine.connect() as conn:
        job = conn.execute(text(
            "SELECT package_id, content_hash, state FROM import_jobs")).one()
        assert job.state == "staged"
        record_count = conn.execute(text("SELECT count(*) FROM import_records")).scalar()
        mapping_count = conn.execute(
            text("SELECT count(*) FROM source_mappings WHERE source_system = 'test'")).scalar()
        # Red line: published/registry tables must remain untouched.
        published = {
            t: conn.execute(text(f"SELECT count(*) FROM {t}")).scalar()
            for t in ("exam_catalogs", "question_registry", "exam_releases",
                      "exam_current_releases", "release_sections")
        }
        report = conn.execute(text("SELECT report FROM import_jobs")).scalar()

    assert record_count == 17  # 1 exam + 2 sec + 2 layer + 2 qt + 2 unit + 3 q + 3 ak + 1 exp + 1 asset
    assert mapping_count == 2
    assert all(v == 0 for v in published.values())
    assert report["hash_algorithm"] == "content-hash-v1"
    assert report["published_tables_written"] is False

    replay = stage_package(pg_engine, package)
    assert replay.idempotent and replay.job_id == result.job_id
    with pg_engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM import_jobs")).scalar() == 1
        assert conn.execute(text("SELECT count(*) FROM import_records")).scalar() == record_count


@requires_db
def test_changed_content_creates_new_job(tmp_path, pg_engine, clean_staging):
    from sqlalchemy import text
    from app.importer.staging import stage_package
    path1 = tmp_path / "a.zip"
    write_zip(make_records(), make_provenance(), path1)
    r1 = stage_package(pg_engine, load_archive(path1)[0])

    records = make_records()
    records["questions.jsonl"][0]["printed_number"] = "31番"
    path2 = tmp_path / "b.zip"
    write_zip(records, make_provenance(), path2)
    r2 = stage_package(pg_engine, load_archive(path2)[0])

    assert not r2.idempotent and r2.content_hash != r1.content_hash and r2.job_id != r1.job_id
    with pg_engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM import_jobs")).scalar() == 2


@requires_db
def test_validation_failure_writes_nothing(tmp_path, pg_engine, clean_staging):
    from sqlalchemy import text
    from app.importer.staging import stage_package
    records = make_records()
    records["answer_keys.private.jsonl"][0]["correct_option_ids"] = ["nope"]
    path = tmp_path / "bad.zip"
    write_zip(records, make_provenance(), path)
    with pytest.raises(ValidationError):
        stage_package(pg_engine, load_archive(path)[0])
    with pg_engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM import_jobs")).scalar() == 0
        assert conn.execute(text("SELECT count(*) FROM import_records")).scalar() == 0


@requires_db
def test_mid_transaction_failure_rolls_back_with_diagnostics(
        tmp_path, pg_engine, clean_staging, monkeypatch):
    from sqlalchemy import text
    import uuid as uuid_mod
    from app.importer import staging as staging_mod
    from app.importer.staging import stage_package

    # Stage one valid package to obtain a committed job id...
    path = tmp_path / "pkg.zip"
    write_zip(make_records(), make_provenance(), path)
    first = stage_package(pg_engine, load_archive(path)[0])

    # ...then force a different-content package to reuse that job id, so the
    # import_jobs PK insert collides mid-transaction.
    records = make_records()
    records["questions.jsonl"][0]["printed_number"] = "31番"
    path2 = tmp_path / "pkg2.zip"
    write_zip(records, make_provenance(), path2)
    diagnostics_dir = tmp_path / "diag"
    job_uuid = uuid_mod.UUID(first.job_id)
    monkeypatch.setattr(staging_mod.uuid, "uuid4", lambda: job_uuid)

    with pytest.raises(StagingError) as exc_info:
        stage_package(pg_engine, load_archive(path2)[0], diagnostics_dir=diagnostics_dir)
    assert exc_info.value.diagnostics_path is not None
    assert exc_info.value.diagnostics_path.exists()

    with pg_engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM import_jobs")).scalar() == 1
        assert conn.execute(text("SELECT count(*) FROM import_records")).scalar() == 17
