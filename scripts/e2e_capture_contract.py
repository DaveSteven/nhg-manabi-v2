"""Capture REAL backend responses as frontend contract fixtures.

Run against the live E2E server (see e2e_seed_n2.py / e2e_api_check.py).
Writes apps/web/app/api/contract-fixtures/<name>.json as
{"schema": <DTO schema export name>, "endpoint": "...", "body": <response>}.
The vitest contract test parses each body with the DTO schema the app uses
for that endpoint, so frontend/back-end drift fails a test, not a page.

    API=http://127.0.0.1:8003 python3 scripts/e2e_capture_contract.py
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import e2e_api_check as c  # noqa: E402

OUT = Path(__file__).resolve().parent.parent / "apps/web/app/api/contract-fixtures"
A = c.USER_A
saved = {}


def save(name, schema, endpoint, resp, ok=(200, 201)):
    status, body, _ = resp
    assert status in ok, f"{name}: HTTP {status} {body}"
    saved[name] = {"schema": schema, "endpoint": endpoint, "body": body}


def sess_paths(sid, suid):
    return f"/api/practice/sessions/{sid}/units/{suid}"


exam = c.current_release()
rid = exam.get("release_id") or exam.get("current_release_id")
save("exams-list", "ExamSummaryList", "GET /api/exams", c.call("GET", "/api/exams"))
save("exam-outline", "ExamOutlineSchema", f"GET /api/exams/{c.EXAM}",
     c.call("GET", f"/api/exams/{c.EXAM}"))
save("exam-layers", "ExamLayersSchema", "GET /api/exams/{id}/layers",
     c.call("GET", f"/api/exams/{c.EXAM}/layers"))
for key in ("vocab", "grammar", "r1", "listen"):
    save(f"release-unit-{key}", "PublicUnitSchema",
         "GET /api/releases/{rid}/units/{uid}",
         c.call("GET", f"/api/releases/{rid}/units/{c.U[key]}"))

c.end_active(A)
s, body = c.new_session(A, rid, [c.U["vocab"], c.U["grammar"]])
assert s == 201
save("session-create", "CreateSessionResponseSchema", "POST /api/practice/sessions",
     (s, body, {}))
sid = body["id"]
suid = {u["unit_id"]: u["id"] for u in body["units"]}
save("session-current", "PracticeSessionSchema", "GET /api/practice/sessions/current",
     c.call("GET", "/api/practice/sessions/current", A))
save("session-get", "PracticeSessionSchema", "GET /api/practice/sessions/{id}",
     c.call("GET", f"/api/practice/sessions/{sid}", A))
vq = c.unit_questions(rid, c.U["vocab"])["questions"][0]
opt = vq["options"][0]["id"]
save("draft-save", "DraftSaveResultSchema", "PUT drafts", c.call(
    "PUT", sess_paths(sid, suid[c.U["vocab"]]) + "/drafts", A,
    {"question_id": vq["id"], "chosen_option_id": opt, "expected_row_version": 0}))
save("drafts-list", "DraftsListSchema", "GET drafts",
     c.call("GET", f"/api/practice/sessions/{sid}/drafts", A))
save("submit-immediate", "SubmitResultSchema", "POST submit (immediate)", c.call(
    "POST", sess_paths(sid, suid[c.U["vocab"]]) + "/submit", A,
    {"answers": [{"question_id": vq["id"], "chosen_option_id": opt}]}))
save("feedback-get", "FeedbackPayloadSchema", "GET feedback", c.call(
    "GET", sess_paths(sid, suid[c.U["vocab"]]) + "/feedback", A))
gq = c.unit_questions(rid, c.U["grammar"])["questions"]
c.call("POST", sess_paths(sid, suid[c.U["grammar"]]) + "/submit", A,
       {"answers": [{"question_id": q["id"], "chosen_option_id": None} for q in gq]})
save("finish-completed", "FinishResponseSchema", "POST finish (completed)",
     c.call("POST", f"/api/practice/sessions/{sid}/finish", A))
save("results-get", "ResultsResponseSchema", "GET results",
     c.call("GET", f"/api/practice/sessions/{sid}/results", A))

s, b2 = c.new_session(A, rid, [c.U["vocab"]], "end")
sid2 = b2["id"]
su2 = b2["units"][0]["id"]
save("submit-end-mode", "SubmitResultSchema", "POST submit (end mode)", c.call(
    "POST", sess_paths(sid2, su2) + "/submit", A,
    {"answers": [{"question_id": vq["id"], "chosen_option_id": opt}]}))
c.call("POST", f"/api/practice/sessions/{sid2}/finish", A)

s, b3 = c.new_session(A, rid, [c.U["r1"], c.U["r2"]])
save("finish-ended-early", "FinishResponseSchema", "POST finish (ended_early)",
     c.call("POST", f"/api/practice/sessions/{b3['id']}/finish", A))

OUT.mkdir(parents=True, exist_ok=True)
for old in OUT.glob("*.json"):
    old.unlink()
for name, fx in saved.items():
    (OUT / f"{name}.json").write_text(
        json.dumps(fx, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
print(f"captured {len(saved)} fixtures -> {OUT}")
