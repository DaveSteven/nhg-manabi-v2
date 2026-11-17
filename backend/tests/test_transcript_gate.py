"""Transcript reveal gate tests (audio-player.md §8).

Listening cues can directly contain answer clues, so GET .../transcript
must obey the same gate as feedback: immediate mode after THAT unit is
submitted, end mode only after the session formally ends. Public unit
payloads never carry cues regardless of submission state.
"""
import os

import pytest
import sqlalchemy as sa

from conftest import CLOZE_UNIT, SINGLE_UNIT

requires_db = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"),
    reason="DATABASE_URL not set; requires migrated PostgreSQL",
)

USER_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
USER_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
TRANSCRIPT_MATERIAL = f"{CLOZE_UNIT}-m-transcript"
CUES = [
    {"index": 1, "start_ms": 0, "end_ms": 12000,
     "children": [{"type": "text", "text": "女：すみません、この近くに……"}]},
    {"index": 2, "start_ms": 12000, "end_ms": 18000,
     "children": [{"type": "text", "text": "男：はい、ありますよ。"}]},
]


@pytest.fixture(autouse=True)
def _study_isolation(clean_study):
    """Wipe the study domain around each test (shared conftest fixture)."""


def make_client(monkeypatch, pg_engine):
    monkeypatch.setenv(
        "DATABASE_URL", pg_engine.url.render_as_string(hide_password=False))
    monkeypatch.setenv("AUTH_MODE", "dev_test")
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("DEV_TEST_USER_IDS", f"{USER_A},{USER_B}")
    from fastapi.testclient import TestClient
    from app.main import app
    return TestClient(app)


def auth(user_id: str) -> dict:
    return {"Authorization": f"Bearer {user_id}"}


def create_session(client, user_id, release_id, unit_ids, feedback="immediate"):
    resp = client.post(
        "/api/practice/sessions", json={
            "feedback_mode": feedback,
            "units": [{"release_id": str(release_id), "unit_id": u}
                      for u in unit_ids],
        }, headers=auth(user_id))
    assert resp.status_code == 201, resp.text
    return resp.json()


def unit_id_map(session: dict) -> dict:
    return {u["unit_id"]: u["id"] for u in session["units"]}


def submit(client, user, sid, suid, answers):
    return client.post(
        f"/api/practice/sessions/{sid}/units/{suid}/submit",
        json={"answers": [{"question_id": q, "chosen_option_id": c}
                          for q, c in answers]},
        headers=auth(user))


@pytest.fixture
def unit_with_transcript(pg_engine, published_release):
    """Attach a cue-bearing transcript material to the cloze unit."""
    with pg_engine.begin() as conn:
        conn.execute(sa.text(
            "INSERT INTO release_unit_materials (release_id, material_id,"
            " unit_id, position, kind, role, language, content, cues)"
            " VALUES (:r, :m, :u, 99, 'transcript', 'primary', 'ja-JP',"
            " NULL, CAST(:cues AS jsonb))"
            " ON CONFLICT (release_id, material_id) DO UPDATE"
            "   SET cues = EXCLUDED.cues"),
            {"r": str(published_release), "m": TRANSCRIPT_MATERIAL,
             "u": CLOZE_UNIT,
             "cues": __import__("json").dumps(CUES)})
    return published_release


def transcript_path(session, suid):
    return f"/api/practice/sessions/{session['id']}/units/{suid}/transcript"


@requires_db
def test_transcript_immediate_mode_sealed_until_submit(
        pg_engine, unit_with_transcript, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    session = create_session(client, USER_A, unit_with_transcript,
                             [CLOZE_UNIT], feedback="immediate")
    suid = unit_id_map(session)[CLOZE_UNIT]

    # Before submission: cues stay sealed even in immediate mode.
    r = client.get(transcript_path(session, suid), headers=auth(USER_A))
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "unit_not_submitted"
    assert "すみません" not in str(r.json())

    submit(client, USER_A, session["id"], suid,
           [(f"{CLOZE_UNIT}-q01", f"{CLOZE_UNIT}-q01-o2"),
            (f"{CLOZE_UNIT}-q02", f"{CLOZE_UNIT}-q02-o1")])
    r = client.get(transcript_path(session, suid), headers=auth(USER_A))
    assert r.status_code == 200
    payload = r.json()
    assert payload["feedback_mode"] == "immediate"
    assert len(payload["materials"]) == 1
    mat = payload["materials"][0]
    assert mat["material_id"] == TRANSCRIPT_MATERIAL
    assert mat["kind"] == "transcript"
    assert mat["cues"][0]["start_ms"] == 0
    assert "すみません" in str(mat["cues"])


@requires_db
def test_transcript_end_mode_sealed_until_session_ends(
        pg_engine, unit_with_transcript, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    session = create_session(client, USER_A, unit_with_transcript,
                             [CLOZE_UNIT], feedback="end")
    suid = unit_id_map(session)[CLOZE_UNIT]

    # drafts only until the whole-session submit: transcript stays sealed
    r = client.get(transcript_path(session, suid), headers=auth(USER_A))
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "unit_not_submitted"

    fin = client.post(
        f"/api/practice/sessions/{session['id']}/submit", json={"answers": [
            {"session_unit_id": suid, "question_id": f"{CLOZE_UNIT}-q01",
             "chosen_option_id": f"{CLOZE_UNIT}-q01-o2"},
            {"session_unit_id": suid, "question_id": f"{CLOZE_UNIT}-q02",
             "chosen_option_id": f"{CLOZE_UNIT}-q02-o1"}]},
        headers=auth(USER_A))
    assert fin.status_code == 200

    r = client.get(transcript_path(session, suid), headers=auth(USER_A))
    assert r.status_code == 200
    assert r.json()["materials"][0]["cues"] == CUES


@requires_db
def test_transcript_pairs_zh_translation_by_paragraph_order(
        pg_engine, unit_with_transcript, monkeypatch):
    """The converter stores the raw `translation` as a unit-level zh-CN
    explanation whose paragraph blocks align with the transcript cues by
    order; paired 1:1 only when the counts match."""
    client = make_client(monkeypatch, pg_engine)
    with pg_engine.begin() as conn:
        zh_blocks = [
            {"type": "paragraph",
             "children": [{"type": "text", "text": t}]}
            for t in ["女：不好意思……", "男：有的哦。"]
        ]
        conn.execute(sa.text(
            "DELETE FROM release_explanations WHERE unit_id = :u"
            "   AND kind = 'translation' AND language = 'zh-CN'"), {"u": CLOZE_UNIT})
        conn.execute(sa.text(
            "INSERT INTO release_explanations (release_id, explanation_id,"
            " unit_id, kind, language, content, revision, review_status)"
            " VALUES (:r, :x, :u, 'translation', 'zh-CN',"
            " CAST(:c AS jsonb), 1, 'unverified')"
            " ON CONFLICT (release_id, explanation_id) DO UPDATE"
            "   SET content = EXCLUDED.content"),
            {"r": str(unit_with_transcript),
             "x": f"{CLOZE_UNIT}-exp-translation-zh-CN-r1", "u": CLOZE_UNIT,
             "c": __import__("json").dumps({"blocks": zh_blocks})})

    session = create_session(client, USER_A, unit_with_transcript,
                             [CLOZE_UNIT], feedback="immediate")
    suid = unit_id_map(session)[CLOZE_UNIT]
    submit(client, USER_A, session["id"], suid,
           [(f"{CLOZE_UNIT}-q01", f"{CLOZE_UNIT}-q01-o2"),
            (f"{CLOZE_UNIT}-q02", f"{CLOZE_UNIT}-q02-o1")])

    r = client.get(transcript_path(session, suid), headers=auth(USER_A))
    assert r.status_code == 200
    tr = r.json()["translation"]
    assert tr["language"] == "zh-CN"
    assert [c["index"] for c in tr["cues"]] == [c["index"] for c in CUES]
    assert tr["cues"][0]["children"][0]["text"] == "女：不好意思……"

    # Before the gate opens, the translation is equally sealed (same 409).
    client.post(f"/api/practice/sessions/{session['id']}/finish",
                headers=auth(USER_A))  # free the active-session slot
    session2 = create_session(client, USER_A, unit_with_transcript,
                              [CLOZE_UNIT], feedback="end")
    suid2 = unit_id_map(session2)[CLOZE_UNIT]
    assert client.get(transcript_path(session2, suid2),
                      headers=auth(USER_A)).status_code == 409


@requires_db
def test_transcript_translation_null_when_counts_mismatch(
        pg_engine, unit_with_transcript, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    with pg_engine.begin() as conn:
        zh_blocks = [{"type": "paragraph",
                      "children": [{"type": "text", "text": "只此一段"}]}]
        conn.execute(sa.text(
            "INSERT INTO release_explanations (release_id, explanation_id,"
            " unit_id, kind, language, content, revision, review_status)"
            " VALUES (:r, :x, :u, 'translation', 'zh-CN',"
            " CAST(:c AS jsonb), 1, 'unverified')"
            " ON CONFLICT (release_id, explanation_id) DO UPDATE"
            "   SET content = EXCLUDED.content"),
            {"r": str(unit_with_transcript),
             "x": f"{CLOZE_UNIT}-exp-translation-zh-CN-r1", "u": CLOZE_UNIT,
             "c": __import__("json").dumps({"blocks": zh_blocks})})

    session = create_session(client, USER_A, unit_with_transcript,
                             [CLOZE_UNIT], feedback="immediate")
    suid = unit_id_map(session)[CLOZE_UNIT]
    submit(client, USER_A, session["id"], suid,
           [(f"{CLOZE_UNIT}-q01", f"{CLOZE_UNIT}-q01-o2"),
            (f"{CLOZE_UNIT}-q02", f"{CLOZE_UNIT}-q02-o1")])
    r = client.get(transcript_path(session, suid), headers=auth(USER_A))
    assert r.status_code == 200
    assert r.json()["translation"] is None


@requires_db
def test_transcript_cross_account_is_404(pg_engine, unit_with_transcript,
                                         monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    session = create_session(client, USER_A, unit_with_transcript,
                             [CLOZE_UNIT], feedback="immediate")
    suid = unit_id_map(session)[CLOZE_UNIT]
    submit(client, USER_A, session["id"], suid,
           [(f"{CLOZE_UNIT}-q01", f"{CLOZE_UNIT}-q01-o2"),
            (f"{CLOZE_UNIT}-q02", f"{CLOZE_UNIT}-q02-o1")])
    assert client.get(transcript_path(session, suid),
                      headers=auth(USER_B)).status_code == 404


@requires_db
def test_transcript_empty_when_no_cue_materials(pg_engine, published_release,
                                                monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    session = create_session(client, USER_A, published_release,
                             [SINGLE_UNIT], feedback="immediate")
    suid = unit_id_map(session)[SINGLE_UNIT]
    submit(client, USER_A, session["id"], suid,
           [(f"{SINGLE_UNIT}-q01", f"{SINGLE_UNIT}-q01-o3")])
    r = client.get(transcript_path(session, suid), headers=auth(USER_A))
    assert r.status_code == 200
    assert r.json()["materials"] == []


@requires_db
def test_public_unit_payload_never_carries_cues(pg_engine,
                                                unit_with_transcript,
                                                monkeypatch):
    """Even after submission, the PUBLIC unit endpoint must not leak cues —
    the transcript is only reachable through the session gate."""
    client = make_client(monkeypatch, pg_engine)
    session = create_session(client, USER_A, unit_with_transcript,
                             [CLOZE_UNIT], feedback="immediate")
    suid = unit_id_map(session)[CLOZE_UNIT]
    submit(client, USER_A, session["id"], suid,
           [(f"{CLOZE_UNIT}-q01", f"{CLOZE_UNIT}-q01-o2"),
            (f"{CLOZE_UNIT}-q02", f"{CLOZE_UNIT}-q02-o1")])

    r = client.get(f"/api/releases/{unit_with_transcript}/units/{CLOZE_UNIT}")
    assert r.status_code == 200
    assert "cues" not in str(r.json())
    assert "すみません" not in str(r.json())
