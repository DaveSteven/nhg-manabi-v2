"""Import JLPT GO 1.0 textbook-practice answers into v2 (ADR-0030).

V1 `attempts` / `attempt_answers` (教材练习) become completed v2 `practice`
sessions with immutable formal answers, tagged `config.supplementary` with
`imported_from = "v1"` (so 我的学习 and the 扩展练习 lists treat them like any
扩展练习 session). `user_question_progress` is a cache DERIVED from formal
answers, so it is rebuilt from them — importing the cache alone would be
overwritten by the next refresh.

Mapping: V1 user -> users.legacy_v1_user_id (ADR-0029); V1 question ->
source_mappings (source_system 'jlptgo-v1-book', source_object_id = V1 id) ->
v2 question in the CURRENT published release. Correctness is re-judged against
the v2 answer key by option POSITION; an answer is skipped (and reported)
when its V1 snapshot key disagrees with v2's key, the question was manually
repaired (its option order changed), the option does not exist, or the unit
is not practicable. Idempotent per V1 attempt. Default dry-run (rolled back).

  python -m app.v1_answer_import --v1-url postgresql+psycopg://... [--apply]
"""
import argparse
import json
import re
import uuid
from collections import Counter
from datetime import datetime, timezone

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

from app.question_progress import rebuild_user_progress
from app.v1_book_convert import MANUAL_FIXES

SOURCE_SYSTEM = "jlptgo-v1-book"
_EXAM_ID_RE = re.compile(r"^JLPTGO-SUP-(N[1-5])-([a-z]+)-L(\d+)$")

V1_ATTEMPTS = ("SELECT id, user_id, created_at, duration_seconds FROM attempts"
               " ORDER BY created_at, id")
V1_ANSWERS = ("SELECT id, attempt_id, user_id, question_id, chosen_option_id,"
              " correct_option_id, is_correct, created_at FROM attempt_answers"
              " ORDER BY attempt_id, id")
V1_OPTIONS = "SELECT id, source_order FROM options"


def _utc(v):
    if v is None:
        return None
    return v.replace(tzinfo=timezone.utc) if v.tzinfo is None else v


def _load_question_info(conn, v1_question_ids: set[int]) -> dict[int, dict]:
    """V1 question id -> v2 question facts of the current published release."""
    mapped = {int(r[0]): r[1] for r in conn.execute(text(
        "SELECT source_object_id, canonical_id FROM source_mappings"
        " WHERE source_system = :s AND canonical_type = 'question'"),
        {"s": SOURCE_SYSTEM}) if str(r[0]).isdigit()}
    info = {}
    for v1_id in v1_question_ids:
        qid = mapped.get(v1_id)
        if qid is None:
            continue
        row = conn.execute(text(
            "SELECT q.release_id, q.unit_id, r.exam_id, u.conversion_status,"
            " k.correct_option_id, k.revision"
            " FROM release_questions q"
            " JOIN exam_current_releases c ON c.release_id = q.release_id"
            " JOIN exam_releases r ON r.id = q.release_id AND r.state = 'published'"
            " JOIN release_units u ON u.release_id = q.release_id AND u.unit_id = q.unit_id"
            " JOIN release_answer_keys k ON k.release_id = q.release_id"
            "  AND k.question_id = q.question_id"
            " WHERE q.question_id = :q"), {"q": qid}).mappings().first()
        if row is None:
            continue
        options = {r[0]: r[1] for r in conn.execute(text(
            "SELECT position, option_id FROM release_options"
            " WHERE release_id = :r AND question_id = :q"),
            {"r": row["release_id"], "q": qid})}
        key_pos = next(p for p, oid in options.items()
                       if oid == row["correct_option_id"])
        info[v1_id] = {**dict(row), "question_id": qid, "options": options,
                       "key_pos": key_pos}
    return info


def import_answers(engine: Engine, attempts: list[dict], answers: list[dict],
                   v1_option_order: dict[int, int], apply: bool) -> dict:
    report = {"attempts": len(attempts), "answers": len(answers),
              "sessions_imported": 0, "answers_imported": 0,
              "already_imported": 0, "skipped_answers": Counter(),
              "skipped_attempts": Counter(), "judgement_changed": 0,
              "users": 0, "applied": apply}
    by_attempt: dict[int, list[dict]] = {}
    for a in answers:
        by_attempt.setdefault(a["attempt_id"], []).append(a)
    with engine.connect() as conn:
        tx = conn.begin()
        legacy_users = {r[0]: r[1] for r in conn.execute(text(
            "SELECT legacy_v1_user_id, id FROM users"
            " WHERE legacy_v1_user_id IS NOT NULL"))}
        done = {int(r[0]) for r in conn.execute(text(
            "SELECT config -> 'supplementary' ->> 'v1_attempt_id' FROM study_sessions"
            " WHERE config -> 'supplementary' ->> 'v1_attempt_id' IS NOT NULL"))}
        info = _load_question_info(conn, {a["question_id"] for a in answers})
        touched: set[uuid.UUID] = set()
        for at in attempts:
            if at["id"] in done:
                report["already_imported"] += 1
                continue
            user_id = legacy_users.get(str(at["user_id"]))
            if user_id is None:
                report["skipped_attempts"]["user_not_imported"] += 1
                continue
            when = _utc(at["created_at"]) or datetime.now(timezone.utc)
            kept = []
            for a in by_attempt.get(at["id"], []):
                v1q = a["question_id"]
                fi = info.get(v1q)
                if fi is None:
                    report["skipped_answers"]["no_v2_question"] += 1
                    continue
                if v1q in MANUAL_FIXES:
                    report["skipped_answers"]["manually_repaired_question"] += 1
                    continue
                if fi["conversion_status"] != "complete":
                    report["skipped_answers"]["unit_not_practicable"] += 1
                    continue
                if v1_option_order.get(a["correct_option_id"]) is None \
                        or v1_option_order[a["correct_option_id"]] + 1 != fi["key_pos"]:
                    report["skipped_answers"]["answer_key_differs"] += 1
                    continue
                chosen_id, is_correct = None, None
                if a["chosen_option_id"] is not None:
                    order = v1_option_order.get(a["chosen_option_id"])
                    chosen_id = fi["options"].get(None if order is None else order + 1)
                    if chosen_id is None:
                        report["skipped_answers"]["chosen_option_missing"] += 1
                        continue
                    is_correct = chosen_id == fi["correct_option_id"]
                    if bool(a["is_correct"]) != is_correct:
                        report["judgement_changed"] += 1
                kept.append((a, fi, chosen_id, is_correct))
            if not kept:
                report["skipped_attempts"]["no_importable_answers"] += 1
                continue
            m = _EXAM_ID_RE.match(kept[0][1]["exam_id"])
            meta = {"kind": "supplementary", "exam_id": kept[0][1]["exam_id"],
                    "level": m.group(1), "subject": m.group(2),
                    "lesson": int(m.group(3)), "imported_from": "v1",
                    "v1_attempt_id": at["id"]}
            session_id = uuid.uuid4()
            conn.execute(text(
                "INSERT INTO study_sessions (id, user_id, mode, feedback_mode, state,"
                " config, created_at, ended_at) VALUES (:id, :u, 'practice',"
                " 'immediate', 'completed', CAST(:cfg AS jsonb), :c, :c)"),
                {"id": session_id, "u": user_id, "c": when, "cfg": json.dumps({
                    "supplementary": meta,
                    "requested_units": [{"release_id": str(fi["release_id"]),
                                         "unit_id": fi["unit_id"]}
                                        for _, fi, _, _ in kept]})})
            for pos, (a, fi, chosen_id, is_correct) in enumerate(kept, start=1):
                su_id = uuid.uuid4()
                at_time = _utc(a.get("created_at")) or when
                conn.execute(text(
                    "INSERT INTO study_session_units (id, session_id, release_id,"
                    " unit_id, position, state, submitted_at)"
                    " VALUES (:id, :s, :r, :u, :p, 'submitted', :t)"),
                    {"id": su_id, "s": session_id, "r": fi["release_id"],
                     "u": fi["unit_id"], "p": pos, "t": at_time})
                conn.execute(text(
                    "INSERT INTO study_submitted_answers (session_unit_id, release_id,"
                    " unit_id, question_id, chosen_option_id, correct_option_id,"
                    " answer_key_revision, is_correct, submitted_at)"
                    " VALUES (:su, :r, :u, :q, :o, :k, :rev, :ok, :t)"),
                    {"su": su_id, "r": fi["release_id"], "u": fi["unit_id"],
                     "q": fi["question_id"], "o": chosen_id,
                     "k": fi["correct_option_id"], "rev": fi["revision"],
                     "ok": is_correct, "t": at_time})
            correct = sum(1 for k in kept if k[3] is True)
            wrong = sum(1 for k in kept if k[3] is False)
            conn.execute(text(
                "INSERT INTO study_results (id, session_id, correct_count, wrong_count,"
                " skipped_count, total_count, scoring_method, scoring_version,"
                " finished_at) VALUES (gen_random_uuid(), :s, :c, :w, :sk, :t,"
                " 'all_questions', '1', :f)"),
                {"s": session_id, "c": correct, "w": wrong,
                 "sk": len(kept) - correct - wrong, "t": len(kept), "f": when})
            report["sessions_imported"] += 1
            report["answers_imported"] += len(kept)
            touched.add(user_id)
        for u in touched:
            rebuild_user_progress(conn, u)
        report["users"] = len(touched)
        if apply:
            tx.commit()
        else:
            tx.rollback()
    report["skipped_answers"] = dict(report["skipped_answers"])
    report["skipped_attempts"] = dict(report["skipped_attempts"])
    return report


def read_v1(v1_url: str):
    engine = create_engine(v1_url)
    try:
        with engine.connect() as c:
            c.execute(text("SET TRANSACTION READ ONLY"))
            attempts = [dict(r) for r in c.execute(text(V1_ATTEMPTS)).mappings()]
            answers = [dict(r) for r in c.execute(text(V1_ANSWERS)).mappings()]
            order = {r[0]: r[1] for r in c.execute(text(V1_OPTIONS))}
    finally:
        engine.dispose()
    return attempts, answers, order


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--v1-url", required=True, help="V1 database URL (read-only)")
    ap.add_argument("--apply", action="store_true",
                    help="commit; default is a dry-run that rolls back")
    args = ap.parse_args(argv)
    from app.db.engine import get_engine
    attempts, answers, order = read_v1(args.v1_url)
    print(json.dumps(import_answers(get_engine(), attempts, answers, order, args.apply),
                     ensure_ascii=False, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
