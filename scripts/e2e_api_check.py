"""M2.3 live-server API acceptance for the synthetic N2 E2E exam.

Runs against a REAL uvicorn process backed by the isolated `<DB>_e2e`
database seeded by `e2e_seed_n2.py` (stdlib only). Mirrors the M2.3 scenario
table (docs/development/M2-core-learning-flow.md §四). Exit code 0 only when
every check passes; each check prints PASS/FAIL with evidence.

    API=http://127.0.0.1:8003 python scripts/e2e_api_check.py [--phase release2]
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request

API = os.environ.get("API", "http://127.0.0.1:8003")
EXAM = "JLPTGO-N2-E2E-EX"
USER_A = "11111111-1111-4111-8111-111111111111"
USER_B = "22222222-2222-4222-8222-222222222222"
U = {n: f"{EXAM}-ly-{l:02d}-u{u:02d}" for n, (l, u) in {
    "vocab": (1, 1), "grammar": (2, 1), "r1": (3, 1), "r2": (3, 2),
    "r3": (3, 3), "listen": (4, 1)}.items()}
results: list[tuple[bool, str]] = []


def call(method, path, user=None, body=None, headers=None):
    h = dict(headers or {})
    if user:
        h["Authorization"] = f"Bearer {user}"
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        h["Content-Type"] = "application/json"
    req = urllib.request.Request(API + path, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw and "json" in r.headers.get(
                "content-type", "") else raw), dict(r.headers)
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw), dict(e.headers)
        except ValueError:
            return e.code, raw, dict(e.headers)


def check(name, ok, evidence=""):
    results.append((bool(ok), name))
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {evidence}"[:240])


def current_release():
    s, body, _ = call("GET", f"/api/exams/{EXAM}")
    assert s == 200, body
    return body


def new_session(user, rid, units, mode="immediate"):
    s, body, _ = call("POST", "/api/practice/sessions", user, {
        "feedback_mode": mode,
        "units": [{"release_id": rid, "unit_id": u} for u in units]})
    return s, body


def end_active(user):
    s, cur, _ = call("GET", "/api/practice/sessions/current", user)
    if s == 200:
        call("POST", f"/api/practice/sessions/{cur['id']}/finish", user)


def unit_questions(rid, unit_id):
    s, unit, _ = call("GET", f"/api/releases/{rid}/units/{unit_id}")
    assert s == 200, unit
    return unit


def find_key(obj, keys):
    """Recursively report forbidden keys present anywhere in a payload."""
    hits = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k in keys:
                hits.append(k)
            hits += find_key(v, keys)
    elif isinstance(obj, list):
        for v in obj:
            hits += find_key(v, keys)
    return hits


LEAK_KEYS = {"correct_option_ids", "correct_option_id", "is_correct",
             "explanations", "explanation", "answer_key", "correct"}


def phase_main():
    end_active(USER_A)
    end_active(USER_B)
    exam = current_release()
    rid = exam.get("release_id") or exam.get("current_release_id")
    check("exam outline served", rid is not None, f"release={rid}")

    # --- structure scenarios -------------------------------------------
    g = unit_questions(rid, U["grammar"])
    qs = g.get("questions", [])
    check("grammar 問題9: 1 Unit / 5 Question", len(qs) == 5, f"questions={len(qs)}")
    slot_ids = sorted(q.get("slot_id") for q in qs)
    check("grammar slots bound 1:1 to questions",
          len(set(slot_ids)) == 5 and None not in slot_ids
          and sorted(g.get("slot_ids", [])) == slot_ids)
    check("public unit has zero answer/explanation fields",
          not find_key(g, LEAK_KEYS), str(find_key(g, LEAK_KEYS)))
    check("reading 問題11: three independent Units",
          all(unit_questions(rid, U[k])["unit_id" if "unit_id" in g else "id"]
              for k in ("r1", "r2", "r3")))
    lu = unit_questions(rid, U["listen"])
    audio = [m for m in lu.get("materials", []) if m.get("kind") == "audio"]
    check("listening unit carries audio material", len(audio) == 1)
    check("public listening payload does not expose cues",
          "cues" not in json.dumps(lu), "cues key absent")
    aid = audio[0].get("asset_id") if audio else None
    s, body, h = call("GET", f"/api/releases/{rid}/assets/{aid}",
                      headers={"Range": "bytes=0-99"})
    check("media Range request -> 206", s == 206 and len(body) == 100,
          f"status={s} content-range={h.get('Content-Range') or h.get('content-range')}")

    # --- session / draft / restore ------------------------------------
    s, sess = new_session(USER_A, rid, [U["vocab"], U["grammar"], U["listen"]])
    check("create session (3 units)", s == 201, f"status={s}")
    sid = sess["id"]
    suid = {u["unit_id"]: u["id"] for u in sess["units"]}
    s2, _ = new_session(USER_A, rid, [U["r1"]])
    check("second active practice -> 409", s2 == 409, f"status={s2}")

    vq = unit_questions(rid, U["vocab"])["questions"][0]
    vopt = vq["options"][0]["id"] if "options" in vq else None
    s, d, _ = call("PUT", f"/api/practice/sessions/{sid}/units/{suid[U['vocab']]}/drafts",
                   USER_A, {"question_id": vq["id"], "chosen_option_id": vopt,
                            "expected_row_version": 0})
    check("draft saved", s == 200, f"status={s}")
    # simulated browser refresh: nothing client-side, only server state
    s, cur, _ = call("GET", "/api/practice/sessions/current", USER_A)
    check("refresh: current session restored", s == 200 and cur["id"] == sid)
    s, drafts, _ = call("GET", f"/api/practice/sessions/{sid}/drafts", USER_A)
    check("refresh: draft restored", s == 200 and vopt in json.dumps(drafts))
    check("drafts payload has no answer leak", not find_key(drafts, LEAK_KEYS))

    # --- cross-account --------------------------------------------------
    for label, method, path, body in (
            ("session", "GET", f"/api/practice/sessions/{sid}", None),
            ("drafts", "GET", f"/api/practice/sessions/{sid}/drafts", None),
            ("results", "GET", f"/api/practice/sessions/{sid}/results", None),
            ("feedback", "GET",
             f"/api/practice/sessions/{sid}/units/{suid[U['vocab']]}/feedback", None),
            ("submit", "POST",
             f"/api/practice/sessions/{sid}/units/{suid[U['vocab']]}/submit",
             {"answers": []}),
            ("draft write", "PUT",
             f"/api/practice/sessions/{sid}/units/{suid[U['vocab']]}/drafts",
             {"question_id": vq["id"], "chosen_option_id": vopt,
              "expected_row_version": 0})):
        s, _, _ = call(method, path, USER_B, body)
        check(f"cross-account {label} -> 404", s == 404, f"status={s}")
    s, _, _ = call("GET", f"/api/practice/sessions/{sid}")
    check("anonymous -> 401", s == 401, f"status={s}")

    # --- submit: vocab answered, duplicate, grammar skipped ------------
    s, sub, _ = call("POST",
                     f"/api/practice/sessions/{sid}/units/{suid[U['vocab']]}/submit",
                     USER_A, {"answers": [{"question_id": vq["id"],
                                           "chosen_option_id": vopt}]})
    check("vocab submit ok", s == 200, f"status={s}")
    s, dup, _ = call("POST",
                     f"/api/practice/sessions/{sid}/units/{suid[U['vocab']]}/submit",
                     USER_A, {"answers": [{"question_id": vq["id"],
                                           "chosen_option_id": vopt}]})
    check("duplicate submit idempotent", s == 200 and dup.get("idempotent") is True,
          f"status={s}")
    s, fb, _ = call("GET",
                    f"/api/practice/sessions/{sid}/units/{suid[U['vocab']]}/feedback",
                    USER_A)
    check("immediate feedback after submit", s == 200)
    s, _, _ = call("GET",
                   f"/api/practice/sessions/{sid}/units/{suid[U['grammar']]}/feedback",
                   USER_A)
    check("feedback for unsubmitted unit refused", s in (403, 404, 409), f"status={s}")
    # grammar: submit with all 5 skipped (empty answers) — skip != wrong
    s, gsub, _ = call("POST",
                      f"/api/practice/sessions/{sid}/units/{suid[U['grammar']]}/submit",
                      USER_A, {"answers": [{"question_id": q["id"],
                                            "chosen_option_id": None} for q in qs]})
    check("grammar group submit with all skipped", s == 200, f"status={s}")
    s, fin, _ = call("POST", f"/api/practice/sessions/{sid}/finish", USER_A)
    check("finish with unsubmitted unit -> ended_early, no result",
          s == 200 and "ended_early" in json.dumps(fin), f"status={s}")
    s, body, _ = call("GET", f"/api/practice/sessions/{sid}/results", USER_A)
    check("ended_early has no results (409 no_results_early_end)",
          s == 409 and "no_results_early_end" in json.dumps(body), f"status={s}")

    # --- full session, end-mode sealing, results identity ---------------
    s, sess2 = new_session(USER_A, rid, [U["vocab"], U["grammar"]], "end")
    sid2 = sess2["id"]
    suid2 = {u["unit_id"]: u["id"] for u in sess2["units"]}
    s, sub, _ = call("POST",
                     f"/api/practice/sessions/{sid2}/units/{suid2[U['vocab']]}/submit",
                     USER_A, {"answers": [{"question_id": vq["id"],
                                           "chosen_option_id": vopt}]})
    check("end-mode submit response has no correctness",
          s == 200 and not find_key(sub, LEAK_KEYS), str(find_key(sub, LEAK_KEYS)))
    s, _, _ = call("GET",
                   f"/api/practice/sessions/{sid2}/units/{suid2[U['vocab']]}/feedback",
                   USER_A)
    check("end-mode feedback sealed before finish", s in (403, 404, 409),
          f"status={s}")
    s, _, _ = call("POST",
                   f"/api/practice/sessions/{sid2}/units/{suid2[U['grammar']]}/submit",
                   USER_A, {"answers": [{"question_id": q["id"],
                                         "chosen_option_id": None} for q in qs]})
    s, fin2, _ = call("POST", f"/api/practice/sessions/{sid2}/finish", USER_A)
    check("all submitted -> completed", s == 200 and "completed" in json.dumps(fin2),
          f"status={s}")
    s, res, _ = call("GET", f"/api/practice/sessions/{sid2}/results", USER_A)
    flat = json.dumps(res)
    check("results readable by owner", s == 200, f"status={s}")
    # total = 1 vocab + 5 grammar; the 5 grammar skips must be skipped, not wrong
    r = res.get("result", res)
    c, w, k, t = (r.get(x) for x in
                  ("correct_count", "wrong_count", "skipped_count", "total_count"))
    check("results identity correct+wrong+skipped=total, skips=5",
          None not in (c, w, k, t) and c + w + k == t == 6 and k == 5,
          f"c={c} w={w} s={k} t={t}")
    s, _, _ = call("GET", f"/api/practice/sessions/{sid2}/results", USER_B)
    check("results cross-account -> 404", s == 404)
    s, fb2, _ = call("GET",
                     f"/api/practice/sessions/{sid2}/units/{suid2[U['vocab']]}/feedback",
                     USER_A)
    check("end-mode feedback opens after finish", s == 200, f"status={s}")

    # --- leave an in-progress session pinned to rev1 for release2 phase
    s, keep = new_session(USER_A, rid, [U["r1"], U["r2"], U["r3"]])
    check("session on release rev1 left open", s == 201)
    print("PINNED_SESSION=" + keep["id"] + " RELEASE=" + rid)


def phase_release2(pinned_session, old_release):
    exam = current_release()
    rid = exam.get("release_id") or exam.get("current_release_id")
    check("new release is now current", rid != old_release,
          f"old={old_release[:8]} new={rid[:8]}")
    s, cur, _ = call("GET", f"/api/practice/sessions/{pinned_session}", USER_A)
    rels = {u["release_id"] for u in cur["units"]}
    check("in-progress session still pinned to OLD release", rels == {old_release},
          str(rels))
    s, old_unit, _ = call("GET", f"/api/releases/{old_release}/units/{U['r1']}")
    s2, new_unit, _ = call("GET", f"/api/releases/{rid}/units/{U['r1']}")
    check("old release unit still readable", s == 200)
    check("new release content differs (revision)",
          s2 == 200 and "改訂" in json.dumps(new_unit, ensure_ascii=False)
          and "改訂" not in json.dumps(old_unit, ensure_ascii=False))
    end_active(USER_A)
    s, _ = new_session(USER_A, old_release, [U["r1"]])
    check("new session on superseded release refused", s in (404, 409, 422),
          f"status={s}")
    s, _ = new_session(USER_A, rid, [U["r1"]])
    check("new session on current release ok", s == 201)
    end_active(USER_A)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--phase", default="main")
    ap.add_argument("--pinned-session")
    ap.add_argument("--old-release")
    a = ap.parse_args()
    if a.phase == "main":
        phase_main()
    else:
        phase_release2(a.pinned_session, a.old_release)
    failed = [n for ok, n in results if not ok]
    print(f"\n{len(results) - len(failed)}/{len(results)} passed")
    sys.exit(1 if failed else 0)
