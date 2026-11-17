"""Strict-mock Phase data (ADR-0019): converter rule table, Canonical
`phases.jsonl` validation/hash/reader, and publication into
release_exam_phases / release_phase_units.

The fixture package (N5, grammar + vocabulary sections, no listening) is
valid with explicit phases; the level rule table is a converter concern and
is tested against its own output.
"""
import copy
import importlib.util
import os
import sys
from pathlib import Path

import pytest
import sqlalchemy as sa

from app.importer.hashing import compute_content_hash
from app.importer.reader import load_archive
from app.importer.validator import validate_package
from importer_fixture import make_provenance, make_records, write_zip

requires_db = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"),
    reason="DATABASE_URL not set; requires migrated PostgreSQL")

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "canonical_v2.py"
spec = importlib.util.spec_from_file_location("canonical_v2_phases", SCRIPT)
conv = importlib.util.module_from_spec(spec)
sys.modules["canonical_v2_phases"] = conv
spec.loader.exec_module(conv)

EX = "JLPTGO-N5-TEST-EX"
ALL = ["vocabulary", "grammar", "reading", "listening"]


def phase(pos, subjects, minutes=10, **over):
    return {"record_type": "exam_phase", "schema_version": "2.0.0",
            "id": f"{EX}-ph{pos}", "exam_id": EX, "position": pos,
            "title": f"Phase {pos}", "duration_seconds": minutes * 60,
            "subjects": subjects, "playback_policy": None, **over}


def with_phases(phases):
    r = make_records()
    r["phases.jsonl"] = phases
    return r


def load(tmp_path, records):
    p = tmp_path / "pkg.zip"
    write_zip(records, make_provenance(), p)
    return load_archive(p)[0]


# ------------------------------------------------------- converter rules ----

@pytest.mark.parametrize("level,expected", [
    ("N1", [("言語知識（文字・語彙・文法）・読解", 110), ("聴解", 55)]),
    ("N2", [("言語知識（文字・語彙・文法）・読解", 105), ("聴解", 50)]),
    ("N3", [("言語知識（文字・語彙）", 30), ("言語知識（文法）・読解", 70), ("聴解", 40)]),
    ("N4", [("言語知識（文字・語彙）", 25), ("言語知識（文法）・読解", 55), ("聴解", 35)]),
    ("N5", [("言語知識（文字・語彙）", 20), ("言語知識（文法）・読解", 40), ("聴解", 30)]),
])
def test_rule_table_matches_official_sections(level, expected):
    ph = conv.build_phases(EX, level, ALL)
    assert [(p["title"], p["duration_seconds"] // 60) for p in ph] == expected
    assert [p["position"] for p in ph] == list(range(1, len(ph) + 1))
    # every subject belongs to exactly one phase
    flat = [s for p in ph for s in p["subjects"]]
    assert sorted(flat) == sorted(ALL)
    assert all(p["record_type"] == "exam_phase" and p["exam_id"] == EX for p in ph)


def test_listening_phase_is_strict_once_only_others_have_no_policy():
    ph = conv.build_phases(EX, "N2", ALL)
    assert ph[0]["playback_policy"] is None
    assert ph[-1]["subjects"] == ["listening"]
    assert ph[-1]["playback_policy"] == {
        "playback": "once", "pausable": False, "seekable": False,
        "speed_control": False}


def test_no_phases_when_a_required_subject_or_level_is_missing():
    assert conv.build_phases(EX, "N2", ["vocabulary", "grammar", "reading"]) is None
    assert conv.build_phases(EX, "N9", ALL) is None
    assert conv.build_phases(EX, "N3", ["grammar", "reading", "listening"]) is None


# --------------------------------------------- validation / hash / reader ----

def test_packages_without_phases_are_unchanged_and_still_valid(tmp_path):
    base = make_records()
    h = compute_content_hash(base)
    assert compute_content_hash(with_phases([])) == h
    pkg = load(tmp_path, base)
    assert pkg.records["phases.jsonl"] == []
    assert not validate_package(pkg).errors


def test_valid_phases_load_validate_and_change_the_content_hash(tmp_path):
    ph = [phase(1, ["grammar"]), phase(2, ["vocabulary"])]
    recs = with_phases(ph)
    assert compute_content_hash(recs) != compute_content_hash(make_records())
    pkg = load(tmp_path, recs)
    vr = validate_package(pkg)
    assert not vr.errors, [i.as_dict() for i in vr.errors]
    assert vr.counts["phases"] == 2


@pytest.mark.parametrize("mutate,code", [
    (lambda p: p[1].update(position=1), "phase_position"),
    (lambda p: p[0].update(duration_seconds=0), "phase_duration"),
    (lambda p: p[0].update(duration_seconds="600"), "phase_duration"),
    (lambda p: p[0].update(title=""), "phase_title"),
    (lambda p: p[0].update(exam_id="OTHER"), "fk_phase_exam"),
    (lambda p: p[0].update(subjects=[]), "phase_subjects"),
    (lambda p: p[0].update(subjects=["grammar", "cooking"]), "phase_subjects"),
    (lambda p: p[1].update(subjects=["vocabulary", "grammar"]), "phase_subject_overlap"),
    (lambda p: p[1].update(subjects=["listening"]), "phase_unit_uncovered"),
    (lambda p: p[0].update(playback_policy="once"), "phase_playback_policy"),
    (lambda p: p[1].update(id=p[0]["id"]), "duplicate_id"),
    (lambda p: p.append(phase(3, ["listening"])), "phase_empty"),
])
def test_invalid_phases_are_rejected(tmp_path, mutate, code):
    ph = copy.deepcopy([phase(1, ["grammar"]), phase(2, ["vocabulary"])])
    mutate(ph)
    pkg = load(tmp_path, with_phases(ph))
    assert code in {i.code for i in validate_package(pkg).errors}


# ------------------------------------------------------------- publishing ----

@requires_db
def test_publish_writes_phases_and_unit_membership_in_order(
        pg_engine, clean_publish, tmp_path):
    from app.importer.staging import stage_package
    from app.publisher import publish_package
    p = tmp_path / "pkg.zip"
    write_zip(with_phases([phase(1, ["vocabulary", "grammar"], 12,
                                 playback_policy=None)]),
              make_provenance(), p)
    stage_package(pg_engine, load_archive(p)[0])
    rid = publish_package(pg_engine, "JLPTGO-N5-TEST-EX-r1")["release_id"]
    with pg_engine.connect() as conn:
        ph = conn.execute(sa.text(
            "SELECT phase_id, position, title, duration_seconds, playback_policy"
            " FROM release_exam_phases WHERE release_id = :r"), {"r": rid}).all()
        pu = conn.execute(sa.text(
            "SELECT unit_id, position FROM release_phase_units"
            " WHERE release_id = :r AND phase_id = :p ORDER BY position"),
            {"r": rid, "p": f"{EX}-ph1"}).all()
        units = conn.execute(sa.text(
            "SELECT count(*) FROM release_units WHERE release_id = :r"),
            {"r": rid}).scalar()
    assert ph == [(f"{EX}-ph1", 1, "Phase 1", 720, None)]
    assert len(pu) == units == 2                      # every unit, exactly once
    assert [p[1] for p in pu] == [1, 2]
    # fixture order: section 1 (grammar) before section 2 (vocabulary)
    assert [u[0] for u in pu] == [f"{EX}-ly-01-u01", f"{EX}-ly-02-u01"]


@requires_db
def test_packages_without_phases_publish_with_no_phase_rows(
        staged_and_published, pg_engine):
    with pg_engine.connect() as conn:
        n = conn.execute(sa.text(
            "SELECT count(*) FROM release_exam_phases WHERE release_id = :r"),
            {"r": staged_and_published["release_id"]}).scalar()
    assert n == 0
