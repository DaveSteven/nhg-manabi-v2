"""Agent review-result sync (lightweight content-review workflow).

Implements the local-Agent-first review loop from docs/data/agent-validation-contract.md:

- build_review_input(): deterministic review task for one Unit (staged
  content + bound content_hash). The Agent echoes this hash in its results.
- sync_agent_reviews(): JSONL of per-Unit results -> content_reviews
  evidence rows + 'agent_verified' answer-key status on DRAFT releases.

Guarantees:
- Stale results (echoed content_hash != current rebuilt hash) are intercepted.
- A "pass" that names an option absent from the staged question is illegal
  and intercepted; a "pass" proposing a different valid option is a
  proposed_change (needs human), not a verification.
- Conflicts with human verdicts on the same content hash are intercepted.
- Same (job_id, review_run_id, question_id) replayed -> no duplicate rows
  (unique constraint uq_content_review_identity + explicit skip).
- Published/withdrawn releases are NEVER mutated by the Agent; review
  evidence is recorded, snapshot rows untouched. Content changes must go
  through a new candidate content hash.
"""
import hashlib
import json
import uuid
from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.engine import Engine

from app.importer.errors import ImportError_ as CanonicalImportError
from app.publisher import _load_staged_package
from app.review_state import (RULE_VERSION_REVIEW, latest_review,
                              open_issues, raise_issue)

ANSWER_PASS = "pass"
ANSWER_BLOCKING = {"needs_review", "blocked", "not_checked"}
UNIT_BLOCKING = {"needs_review", "blocked"}


class ReviewSyncError(CanonicalImportError):
    """Malformed sync request."""


# --------------------------------------------------------------- binding ----

def build_review_input(engine: Engine, package_id: str, unit_id: str) -> dict:
    """Deterministic review task for one staged Unit, with bound content_hash."""
    _, package = _load_staged_package(engine, package_id)
    return _build_input_for(package, unit_id)


def _build_input_for(package, unit_id: str) -> dict:
    units = {u["id"]: u for u in package.records["units.jsonl"]}
    unit = units.get(unit_id)
    if unit is None:
        raise ReviewSyncError(f"unit {unit_id!r} not in staged package")
    exam = package.records["exam.json"][0]
    questions = [q for q in package.records["questions.jsonl"]
                 if q["unit_id"] == unit_id]
    keys = {k["question_id"]: k for k in package.records["answer_keys.private.jsonl"]}
    payload = {
        "contract_version": "2.0",
        "job_id": f"review-{package.package_id}-{unit_id}",
        "package_id": package.package_id,
        "schema_version": "2.0.0",
        "exam_id": exam["id"],
        "unit_id": unit_id,
        "unit": {"kind": unit["kind"], "materials": unit.get("materials", []),
                 "slot_ids": unit.get("slot_ids", [])},
        "questions": [
            {"id": q["id"], "prompt": q.get("prompt"), "options": q["options"]}
            for q in questions
        ],
        "answer_keys_private": [
            {"question_id": k["question_id"],
             "correct_option_id": k["correct_option_ids"][0],
             "revision": k["revision"]}
            for q in questions if (k := keys.get(q["id"]))
        ],
        "provenance_ref": None,
        "media_review_refs": [],
    }
    payload["content_hash"] = hashlib.sha256(
        json.dumps(payload, ensure_ascii=False, sort_keys=True,
                   separators=(",", ":")).encode("utf-8")).hexdigest()
    return payload


def _staged_key_for(package, question_id: str) -> dict | None:
    for k in package.records["answer_keys.private.jsonl"]:
        if k["question_id"] == question_id:
            return k
    return None


def _staged_option_ids(package, question_id: str) -> set[str]:
    for q in package.records["questions.jsonl"]:
        if q["id"] == question_id:
            return {o["id"] for o in q["options"]}
    return set()


# ------------------------------------------------------------------ sync ----

def sync_agent_reviews(engine: Engine, package_id: str,
                       results: list[dict]) -> dict:
    """Apply a batch of Agent unit-review results. Idempotent per batch."""
    if not isinstance(results, list):
        raise ReviewSyncError("results must be a list of unit result objects")
    staged_hash, package = _load_staged_package(engine, package_id)
    exam_id = package.records["exam.json"][0]["id"]
    unit_ids = {u["id"] for u in package.records["units.jsonl"]}

    applied, already_present, intercepted = [], [], []
    with engine.begin() as conn:
        release = conn.execute(text(
            "SELECT id, state FROM exam_releases"
            " WHERE exam_id = :e AND content_hash = :h"),
            {"e": exam_id, "h": staged_hash}).first()

        for result in results:
            unit_id = result.get("unit_id")
            job_id = result.get("job_id")
            run_id = result.get("review_run_id")
            if not unit_id or unit_id not in unit_ids:
                intercepted.append({"unit_id": unit_id, "reason": "unknown_unit"})
                continue
            if not job_id or not run_id:
                intercepted.append({"unit_id": unit_id,
                                    "reason": "missing job_id/review_run_id"})
                continue

            current_input = _build_input_for(package, unit_id)
            if result.get("content_hash") != current_input["content_hash"]:
                intercepted.append({"unit_id": unit_id, "reason": "stale_content_hash",
                                    "echoed": result.get("content_hash")})
                continue

            reviewer_id = f"{job_id}/{run_id}"
            agent_meta = {"agent": result.get("agent"),
                          "unit_status": result.get("status")}
            unit_verdict = result.get("status")

            # Unit-level gate evidence (blocks promote when needs_review/blocked).
            # Blocking verdicts raise a trackable issue; the review row links it.
            unit_status = ("needs_review" if unit_verdict in UNIT_BLOCKING
                           else "agent_verified" if unit_verdict == ANSWER_PASS
                           else "needs_review")
            unit_issue_id = None
            if unit_status in UNIT_BLOCKING:
                unit_issue_id = raise_issue(
                    conn, "agent_review", "agent_unit_flag", "unit", unit_id,
                    current_input["content_hash"], "blocking",
                    RULE_VERSION_REVIEW,
                    {"unit_status": unit_verdict, "job_id": job_id,
                     "review_run_id": run_id})["id"]
            conn.execute(text(
                "INSERT INTO content_reviews (id, record_type, canonical_id,"
                " content_hash, reviewer_type, reviewer_id, review_status,"
                " evidence, checked_at, issue_id)"
                " VALUES (:id, 'unit', :cid, :chash, 'agent', :rid, :status,"
                " CAST(:ev AS jsonb), :at, :iid)"
                " ON CONFLICT ON CONSTRAINT uq_content_review_identity DO NOTHING"),
                {"id": uuid.uuid4(), "cid": unit_id,
                 "chash": current_input["content_hash"], "rid": reviewer_id,
                 "status": unit_status,
                 "ev": json.dumps(agent_meta, ensure_ascii=False),
                 "at": _checked_at(result), "iid": unit_issue_id})

            for q in result.get("questions", []):
                qid = q.get("question_id")
                verdict = q.get("answer")
                staged_key = _staged_key_for(package, qid)
                if staged_key is None:
                    intercepted.append({"unit_id": unit_id, "question_id": qid,
                                        "reason": "unknown_question"})
                    continue

                dup = conn.execute(text(
                    "SELECT 1 FROM content_reviews WHERE record_type = 'answer_key'"
                    " AND canonical_id = :cid AND content_hash = :chash"
                    " AND reviewer_type = 'agent' AND reviewer_id = :rid"),
                    {"cid": qid, "chash": current_input["content_hash"],
                     "rid": reviewer_id}).first()
                if dup is not None:
                    already_present.append({"question_id": qid})
                    continue

                expected_rev = q.get("expected_revision")
                if expected_rev is not None and expected_rev != staged_key["revision"]:
                    intercepted.append({"unit_id": unit_id, "question_id": qid,
                                        "reason": "revision_conflict",
                                        "expected": expected_rev,
                                        "staged": staged_key["revision"]})
                    _record(conn, qid, current_input["content_hash"], reviewer_id,
                            "unverified", {"conflict": "revision", **agent_meta}, result)
                    continue

                independent = q.get("independent_answer_option_id")
                staged_option = staged_key["correct_option_ids"][0]

                if verdict == ANSWER_PASS:
                    if independent is not None and independent not in _staged_option_ids(package, qid):
                        intercepted.append({"unit_id": unit_id, "question_id": qid,
                                            "reason": "illegal_option",
                                            "option": independent})
                        _record(conn, qid, current_input["content_hash"], reviewer_id,
                                "unverified", {"conflict": "illegal_option",
                                               "option": independent, **agent_meta}, result)
                        continue
                    if independent is not None and independent != staged_option:
                        # Agent proposes a different valid option: record, no
                        # verification — and a trackable issue a human resolves.
                        issue = raise_issue(
                            conn, "agent_review", "agent_proposed_answer",
                            "answer_key", qid,
                            current_input["content_hash"], "blocking",
                            RULE_VERSION_REVIEW,
                            {"proposed_option": independent,
                             "staged_option": staged_option, **agent_meta})
                        _record(conn, qid, current_input["content_hash"], reviewer_id,
                                "needs_review",
                                {"proposed_option": independent,
                                 "staged_option": staged_option,
                                 "issue_id": issue["id"], **agent_meta}, result,
                                issue_id=issue["id"])
                        continue
                    # An ordinary Agent pass never auto-clears an unresolved
                    # dispute: open blocking issues on this exact content
                    # dominate, regardless of how many passes follow.
                    open_blocking = open_issues(conn, "answer_key", qid,
                                                current_input["content_hash"],
                                                severity="blocking")
                    if open_blocking:
                        intercepted.append({"unit_id": unit_id, "question_id": qid,
                                            "reason": "open_issue",
                                            "issues": [str(i.id) for i in open_blocking]})
                        _record(conn, qid, current_input["content_hash"], reviewer_id,
                                "unverified",
                                {"conflict": "open_issue",
                                 "issues": [str(i.id) for i in open_blocking],
                                 **agent_meta}, result)
                        continue
                    dispute = latest_review(conn, "answer_key", qid,
                                            current_input["content_hash"],
                                            reviewer_type="human")
                    if dispute is not None and dispute.review_status == "disputed":
                        intercepted.append({"unit_id": unit_id, "question_id": qid,
                                            "reason": "human_conflict",
                                            "human_status": dispute.review_status})
                        _record(conn, qid, current_input["content_hash"], reviewer_id,
                                "unverified",
                                {"conflict": "human_disputed", **agent_meta}, result)
                        continue

                    _record(conn, qid, current_input["content_hash"], reviewer_id,
                            "agent_verified", {"verified_option": staged_option,
                                               **agent_meta}, result)
                    applied.append({"question_id": qid})
                    # Mutate DRAFT snapshot rows only; published/withdrawn releases
                    # are never touched by the Agent (evidence stays for the next
                    # candidate version).
                    if release is not None and release.state in ("draft", "in_review"):
                        conn.execute(text(
                            "UPDATE release_answer_keys SET review_status ="
                            " 'agent_verified' WHERE release_id = :r AND"
                            " question_id = :q"),
                            {"r": release.id, "q": qid})
                else:
                    # needs_review / blocked / not_checked / proposed_change:
                    # evidence only, never a verification. Explicit blocking
                    # verdicts raise a trackable issue.
                    blocking = verdict in ANSWER_BLOCKING
                    issue_id = None
                    if blocking:
                        issue_id = raise_issue(
                            conn, "agent_review", "agent_answer_flag",
                            "answer_key", qid, current_input["content_hash"],
                            "blocking", RULE_VERSION_REVIEW,
                            {"agent_answer": verdict, **agent_meta})["id"]
                    _record(conn, qid, current_input["content_hash"], reviewer_id,
                            "needs_review" if blocking else "unverified",
                            {"agent_answer": verdict, **agent_meta}, result,
                            issue_id=issue_id)

    return {
        "ok": True,
        "package_id": package_id,
        "staged_content_hash": staged_hash,
        "release_id": str(release.id) if release is not None else None,
        "release_state": release.state if release is not None else None,
        "applied_count": len(applied),
        "already_present_count": len(already_present),
        "intercepted": intercepted,
        "applied": applied,
    }


def apply_human_reviews(engine: Engine, package_id: str) -> dict:
    """Reflect explicit HUMAN confirmations onto the DRAFT release snapshot.

    An answer key whose latest review (by sequence, at the unit's current
    input hash) is a human ``human_reviewed`` row — written by
    ``resolve_issue`` — with no open blocking issue becomes
    ``human_reviewed`` in the draft release. The state records the truth
    (a human confirmed it), never an Agent stamp. Idempotent; keys already
    verified are untouched; published/withdrawn releases are never mutated.
    """
    from app.review_state import latest_review, open_issues

    staged_hash, package = _load_staged_package(engine, package_id)
    exam_id = package.records["exam.json"][0]["id"]
    applied = []
    with engine.begin() as conn:
        release = conn.execute(text(
            "SELECT id, state FROM exam_releases"
            " WHERE exam_id = :e AND content_hash = :h"),
            {"e": exam_id, "h": staged_hash}).first()
        if release is None or release.state not in ("draft", "in_review"):
            return {"ok": True, "package_id": package_id, "applied_count": 0,
                    "release_state": release.state if release else None,
                    "applied": []}
        for u in package.records["units.jsonl"]:
            unit_hash = _build_input_for(package, u["id"])["content_hash"]
            for q in [q for q in package.records["questions.jsonl"]
                      if q["unit_id"] == u["id"]]:
                qid = q["id"]
                if open_issues(conn, "answer_key", qid, unit_hash,
                               severity="blocking"):
                    continue
                row = latest_review(conn, "answer_key", qid, unit_hash)
                if (row is None or row.reviewer_type != "human"
                        or row.review_status != "human_reviewed"):
                    continue
                n = conn.execute(text(
                    "UPDATE release_answer_keys SET review_status ="
                    " 'human_reviewed' WHERE release_id = :r AND"
                    " question_id = :q AND review_status NOT IN"
                    " ('agent_verified', 'human_reviewed')"),
                    {"r": release.id, "q": qid}).rowcount
                if n:
                    applied.append({"question_id": qid,
                                    "reviewer_id": row.reviewer_id})
    return {"ok": True, "package_id": package_id,
            "applied_count": len(applied), "release_state": release.state,
            "applied": applied}


def _checked_at(result: dict):
    raw = result.get("checked_at")
    if raw:
        try:
            return datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            pass
    return datetime.now(timezone.utc)


def _record(conn, canonical_id: str, content_hash: str, reviewer_id: str,
            status: str, evidence: dict, result: dict,
            issue_id: str | None = None) -> None:
    conn.execute(text(
        "INSERT INTO content_reviews (id, record_type, canonical_id,"
        " content_hash, reviewer_type, reviewer_id, review_status,"
        " evidence, checked_at, issue_id)"
        " VALUES (:id, 'answer_key', :cid, :chash, 'agent', :rid, :status,"
        " CAST(:ev AS jsonb), :at, :iid)"
        " ON CONFLICT ON CONSTRAINT uq_content_review_identity DO NOTHING"),
        {"id": uuid.uuid4(), "cid": canonical_id, "chash": content_hash,
         "rid": reviewer_id, "status": status,
         "ev": json.dumps(evidence, ensure_ascii=False),
         "at": _checked_at(result), "iid": issue_id})


def load_results(path) -> list[dict]:
    results = []
    with open(path, encoding="utf-8") as f:
        for lineno, line in enumerate(f, start=1):
            if not line.strip():
                continue
            try:
                results.append(json.loads(line))
            except json.JSONDecodeError as e:
                raise ReviewSyncError(f"{path}:{lineno}: invalid JSON ({e})") from e
    return results


if __name__ == "__main__":
    import argparse
    import sys

    parser = argparse.ArgumentParser(description="Agent review-result sync")
    sub = parser.add_subparsers(dest="command", required=True)
    p_build = sub.add_parser("build")
    p_build.add_argument("package_id")
    p_build.add_argument("unit_id")
    p_sync = sub.add_parser("sync")
    p_sync.add_argument("package_id")
    p_sync.add_argument("results_jsonl")
    p_human = sub.add_parser("apply-human")
    p_human.add_argument("package_id")
    args = parser.parse_args()

    from app.db.engine import get_engine
    engine = get_engine()
    if args.command == "apply-human":
        print(json.dumps(apply_human_reviews(engine, args.package_id),
                         ensure_ascii=False))
        sys.exit(0)
    if args.command == "build":
        print(json.dumps(build_review_input(engine, args.package_id, args.unit_id),
                         ensure_ascii=False))
    else:
        report = sync_agent_reviews(engine, args.package_id,
                                    load_results(args.results_jsonl))
        print(json.dumps(report, ensure_ascii=False))
        sys.exit(0 if report["ok"] else 1)
