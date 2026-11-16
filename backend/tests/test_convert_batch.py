"""Batch conversion helpers in scripts/canonical_v2.py (discovery + id rules)."""
import importlib.util
import json
import sys
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "canonical_v2.py"
spec = importlib.util.spec_from_file_location("canonical_v2", SCRIPT)
canonical_v2 = importlib.util.module_from_spec(spec)
sys.modules["canonical_v2"] = canonical_v2   # required by @dataclass
spec.loader.exec_module(canonical_v2)


def _mk(root: Path, level: str, oid: str, year, month, tag=None):
    d = root / level / oid
    d.mkdir(parents=True)
    meta = {"year": year, "month": month, "tag": tag or level}
    (d / "metadata.json").write_text(json.dumps(meta), encoding="utf-8")
    return d


def test_discover_exams_lists_every_level_sorted_with_package_ids(tmp_path):
    _mk(tmp_path, "N2", "bbb", 2018, 12)
    _mk(tmp_path, "N2", "aaa", 2019, 7)
    _mk(tmp_path, "N5", "ccc", 2020, 7)
    (tmp_path / "N1").mkdir()                    # empty level is fine
    (tmp_path / "README.md").write_text("x")     # stray file ignored
    found = canonical_v2.discover_exams(tmp_path)
    assert [(e.level, e.year, e.month) for e in found] == [
        ("N2", 2018, 12), ("N2", 2019, 7), ("N5", 2020, 7)]
    assert found[0].package_id == "JLPTGO-N2-2018-12-r1"
    assert found[1].package_id == "JLPTGO-N2-2019-07-r1"


def test_discover_exams_reports_unreadable_and_duplicate_metadata(tmp_path):
    _mk(tmp_path, "N3", "one", 2021, 12)
    _mk(tmp_path, "N3", "two", 2021, 12)          # same exam scraped twice
    bad = tmp_path / "N3" / "bad"
    bad.mkdir()
    (bad / "metadata.json").write_text("{not json")
    found = canonical_v2.discover_exams(tmp_path)
    assert len(found) == 1, "first of a duplicate pair wins, deterministic by dir name"
    assert found[0].object_id == "one"
    problems = canonical_v2.discover_exams.last_problems
    assert {p["object_id"] for p in problems} == {"two", "bad"}
    assert {p["reason"] for p in problems} == {"duplicate_exam", "unreadable_metadata"}
