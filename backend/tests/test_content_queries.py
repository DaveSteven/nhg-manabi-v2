"""M2 Task 02 tests: content query API (exam outline, layers, unit fetch).

Extends the leak checks from test_publisher to the new outline endpoints and
the release-scoped unit fetch used by in-progress sessions.
"""
import json
import os

import pytest

from conftest import CLOZE_UNIT, EXAM_ID, SINGLE_UNIT

requires_db = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"),
    reason="DATABASE_URL not set; requires migrated PostgreSQL",
)

LEAK_MARKERS = ("answer_key", "correct_option_id", "review_status",
                "explanations", "provenance", "availability")


def make_client(monkeypatch, pg_engine):
    monkeypatch.setenv(
        "DATABASE_URL", pg_engine.url.render_as_string(hide_password=False))
    from fastapi.testclient import TestClient
    from app.main import app
    return TestClient(app)


@requires_db
def test_exam_outline_structure_and_no_leaks(pg_engine, published_release,
                                             monkeypatch):
    client = make_client(monkeypatch, pg_engine)

    exams = client.get("/api/exams").json()
    assert [e["exam_id"] for e in exams] == [EXAM_ID]
    assert exams[0]["release_id"] == published_release

    outline = client.get(f"/api/exams/{EXAM_ID}")
    assert outline.status_code == 200
    outline = outline.json()
    assert outline["release_id"] == published_release
    assert len(outline["sections"]) == 2
    units = [u for s in outline["sections"] for l in s["layers"]
             for u in l["units"]]
    assert sorted(u["unit_id"] for u in units) == sorted(
        [CLOZE_UNIT, SINGLE_UNIT])
    counts = {u["unit_id"]: u["question_count"] for u in units}
    assert counts[CLOZE_UNIT] == 2 and counts[SINGLE_UNIT] == 1
    assert all(u["position"] >= 1 for u in units)

    flat = json.dumps(outline, ensure_ascii=False)
    for marker in LEAK_MARKERS:
        assert marker not in flat, f"leak marker in outline: {marker}"


@requires_db
def test_layers_endpoint_returns_counts_not_units(pg_engine,
                                                  published_release,
                                                  monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    layers = client.get(f"/api/exams/{EXAM_ID}/layers")
    assert layers.status_code == 200
    layers = layers.json()
    all_layers = [l for s in layers["sections"] for l in s["layers"]]
    assert len(all_layers) == 2
    assert all("unit_count" in l for l in all_layers)
    assert sum(l["unit_count"] for l in all_layers) == 2
    assert all("units" not in l for l in all_layers)


@requires_db
def test_release_scoped_unit_fetch(pg_engine, published_release, monkeypatch):
    client = make_client(monkeypatch, pg_engine)

    resp = client.get(f"/api/releases/{published_release}/units/{CLOZE_UNIT}")
    assert resp.status_code == 200
    unit = resp.json()
    assert unit["release_id"] == published_release
    assert len(unit["questions"]) == 2
    # Options must come back in canonical order with printed numbers.
    q1 = unit["questions"][0]
    assert [o["position"] for o in q1["options"]] == [1, 2, 3]
    assert q1["printed_number"] is not None or q1["position"] == 1
    flat = json.dumps(unit, ensure_ascii=False)
    for marker in LEAK_MARKERS:
        assert marker not in flat, f"leak marker in unit payload: {marker}"

    # Same answer via the exam-keyed path (current release pointer).
    via_exam = client.get(f"/api/exams/{EXAM_ID}/units/{CLOZE_UNIT}")
    assert via_exam.status_code == 200
    assert via_exam.json()["release_id"] == published_release


@requires_db
def test_draft_release_not_served_by_public_unit_fetch(
        pg_engine, staged_and_published, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    draft_id = staged_and_published["release_id"]
    resp = client.get(f"/api/releases/{draft_id}/units/{CLOZE_UNIT}")
    assert resp.status_code == 404
    assert client.get(f"/api/exams/{EXAM_ID}").status_code == 404
    assert client.get(f"/api/exams/{EXAM_ID}/layers").status_code == 404


@requires_db
def test_unknown_exam_and_unit_404(pg_engine, published_release, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    assert client.get("/api/exams/NOPE").status_code == 404
    assert client.get("/api/exams/NOPE/layers").status_code == 404
    assert client.get(
        f"/api/exams/{EXAM_ID}/units/NOPE-UNIT").status_code == 404
    assert client.get(
        f"/api/releases/{published_release}/units/NOPE-UNIT"
    ).status_code == 404
