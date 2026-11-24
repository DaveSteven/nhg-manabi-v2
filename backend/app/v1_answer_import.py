"""Import JLPT GO 1.0 practice answers into v2 (ADR-0030).

Two sources, selected with --kind:
- `textbook` (default): V1 `attempts` / `attempt_answers` (教材练习). Sessions
  are tagged `config.supplementary` with `imported_from = "v1"`, so 我的学习
  and the 扩展练习 lists treat them like any 扩展练习 session.
- `exam`: V1 `practice_attempts` / `practice_attempt_answers` (真题专项练习).
  Sessions are tagged `config.imported = {source: "v1_practice", attempt_id}`;
  they are formal answers (they feed coverage, still-wrong and sampling) but
  are NOT listed in 练习历史 — V1 answers are per question while v2 sessions
  hold whole Units, and V1 专项 categories do not map to v2 question types.
  Only the questions the user actually answered are stored (never fabricated
  skips for the rest of a group Unit).

`user_question_progress` is a cache DERIVED from formal answers, so it is
rebuilt from them — importing the cache alone would be overwritten by the
next refresh.

Mapping: V1 user -> users.legacy_v1_user_id (ADR-0029); textbook question ->
source_mappings ('jlptgo-v1-book', source_object_id = V1 id); exam question ->
V1 identity -> upstream objectId (raw exam.json files, --raw-dir) ->
source_mappings ('mojitest') -> v2 question in the CURRENT published release.
Correctness is re-judged against
the v2 answer key by option POSITION; an answer is skipped (and reported)
when its V1 snapshot key disagrees with v2's key, the question was manually
repaired (its option order changed), the option does not exist, or the unit
is not practicable. Idempotent per V1 attempt. Default dry-run (rolled back).

  python -m app.v1_answer_import --v1-url postgresql+psycopg://... [--apply]
  python -m app.v1_answer_import --kind exam --raw-dir data/samples --v1-url ...
"""
import argparse
import glob
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


def textbook_question_map(conn) -> dict[int, str]:
    return {int(r[0]): r[1] for r in conn.execute(text(
        "SELECT source_object_id, canonical_id FROM source_mappings"
        " WHERE source_system = :s AND canonical_type = 'question'"),
        {"s": SOURCE_SYSTEM}) if str(r[0]).isdigit()}


def exam_question_map(conn, identities: dict[int, str], raw_dir,
                      object_system: str = "mojitest") -> dict[int, str]:
    """V1 exam question id -> v2 canonical question id, via the raw upstream
    exam.json files that carry both the V1 `identity` and the objectId."""
    ident2obj: dict[str, str] = {}

    def walk(o):
        if isinstance(o, dict):
            if "identity" in o and "objectId" in o:
                ids = o["identity"] if isinstance(o["identity"], list) else [o["identity"]]
                for i in ids:
                    ident2obj[str(i)] = o["objectId"]
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)

    for f in glob.glob(f"{raw_dir}/**/exam.json", recursive=True):
        with open(f, encoding="utf-8") as fh:
            walk(json.load(fh))
    obj2can = {r[0]: r[1] for r in conn.execute(text(
        "SELECT source_object_id, canonical_id FROM source_mappings"
        " WHERE source_system = :s AND canonical_type = 'question'"),
        {"s": object_system})}
    out = {}
    for v1_id, raw in identities.items():
        try:
            ident = (json.loads(raw) or [None])[0]
        except (TypeError, ValueError):
            ident = None
        can = obj2can.get(ident2obj.get(ident))
        if can is not None:
            out[v1_id] = can
    return out


def _load_question_info(conn, mapped: dict[int, str],
                        v1_question_ids: set[int]) -> dict[int, dict]:
    """V1 question id -> v2 question facts of the current published release."""
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
                   v1_option_order: dict[int, int], apply: bool, *,
                   kind: str = "textbook", mapped: dict[int, str] | None = None,
                   identities: dict[int, str] | None = None, raw_dir=None,
                   object_system: str = "mojitest",
                   v1_usernames: dict[str, str] | None = None) -> dict:
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
        if v1_usernames:
            # A V1 rebuilt from a backup carries different user ids for the
            # same people: fall back to the (unique) username, still limited
            # to accounts that came from V1.
            by_name = {r[0]: r[1] for r in conn.execute(text(
                "SELECT username, id FROM users WHERE legacy_v1_user_id IS NOT NULL"
                " AND username IS NOT NULL"))}
            for v1_id, name in v1_usernames.items():
                if v1_id not in legacy_users and name in by_name:
                    legacy_users[v1_id] = by_name[name]
        marker = ("config -> 'supplementary' ->> 'v1_attempt_id'" if kind == "textbook"
                  else "config -> 'imported' ->> 'attempt_id'")
        # (id, created_at): a V1 restored from an older backup hands out the
        # same attempt ids again for different attempts, so id alone is not a key
        done = {(int(r[0]), r[1]) for r in conn.execute(text(
            f"SELECT {marker}, created_at FROM study_sessions"
            f" WHERE {marker} IS NOT NULL"))}
        if mapped is None:
            mapped = (textbook_question_map(conn) if kind == "textbook"
                      else exam_question_map(conn, identities or {}, raw_dir,
                                             object_system))
        info = _load_question_info(conn, mapped, {a["question_id"] for a in answers})
        touched: set[uuid.UUID] = set()
        for at in attempts:
            if (at["id"], _utc(at["created_at"])) in done:
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
                if kind == "textbook" and v1q in MANUAL_FIXES:
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
            if kind == "textbook":
                m = _EXAM_ID_RE.match(kept[0][1]["exam_id"])
                tag = {"supplementary": {
                    "kind": "supplementary", "exam_id": kept[0][1]["exam_id"],
                    "level": m.group(1), "subject": m.group(2),
                    "lesson": int(m.group(3)), "imported_from": "v1",
                    "v1_attempt_id": at["id"]}}
            else:
                tag = {"imported": {"source": "v1_practice", "attempt_id": at["id"]}}
            session_id = uuid.uuid4()
            conn.execute(text(
                "INSERT INTO study_sessions (id, user_id, mode, feedback_mode, state,"
                " config, created_at, ended_at) VALUES (:id, :u, 'practice',"
                " 'immediate', 'completed', CAST(:cfg AS jsonb), :c, :c)"),
                {"id": session_id, "u": user_id, "c": when, "cfg": json.dumps({
                    **tag,
                    "requested_units": [
                        {"release_id": rid, "unit_id": uid} for rid, uid in
                        dict.fromkeys((str(fi["release_id"]), fi["unit_id"])
                                      for _, fi, _, _ in kept)]})})
            # one session unit per v2 Unit: answers of the same (group) Unit share
            # it; a question answered twice in one attempt opens another unit
            groups: list[dict] = []
            for item in kept:
                a, fi, _, _ = item
                key = (str(fi["release_id"]), fi["unit_id"])
                g = next((g for g in groups if g["key"] == key
                          and fi["question_id"] not in g["questions"]), None)
                if g is None:
                    g = {"key": key, "fi": fi, "questions": set(), "items": []}
                    groups.append(g)
                g["questions"].add(fi["question_id"])
                g["items"].append(item)
            for pos, g in enumerate(groups, start=1):
                su_id = uuid.uuid4()
                fi = g["fi"]
                times = [_utc(i[0].get("created_at")) or when for i in g["items"]]
                conn.execute(text(
                    "INSERT INTO study_session_units (id, session_id, release_id,"
                    " unit_id, position, state, submitted_at)"
                    " VALUES (:id, :s, :r, :u, :p, 'submitted', :t)"),
                    {"id": su_id, "s": session_id, "r": fi["release_id"],
                     "u": fi["unit_id"], "p": pos, "t": max(times)})
                for (a, fi2, chosen_id, is_correct), at_time in zip(g["items"], times):
                    conn.execute(text(
                        "INSERT INTO study_submitted_answers (session_unit_id,"
                        " release_id, unit_id, question_id, chosen_option_id,"
                        " correct_option_id, answer_key_revision, is_correct,"
                        " submitted_at) VALUES (:su, :r, :u, :q, :o, :k, :rev,"
                        " :ok, :t)"),
                        {"su": su_id, "r": fi2["release_id"], "u": fi2["unit_id"],
                         "q": fi2["question_id"], "o": chosen_id,
                         "k": fi2["correct_option_id"], "rev": fi2["revision"],
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


V1_EXAM_ATTEMPTS = ("SELECT id, user_id, created_at, duration_seconds FROM"
                    " practice_attempts ORDER BY created_at, id")
V1_EXAM_ANSWERS = ("SELECT id, attempt_id, user_id, question_id, chosen_option_id,"
                   " correct_option_id, is_correct, created_at FROM"
                   " practice_attempt_answers ORDER BY attempt_id, id")
V1_EXAM_OPTIONS = "SELECT id, source_order FROM exam_options"
V1_EXAM_IDENTITIES = ("SELECT id, identity_json FROM exam_questions WHERE id IN"
                      " (SELECT question_id FROM practice_attempt_answers)")


def read_v1(v1_url: str, kind: str = "textbook"):
    engine = create_engine(v1_url)
    q = ((V1_ATTEMPTS, V1_ANSWERS, V1_OPTIONS) if kind == "textbook"
         else (V1_EXAM_ATTEMPTS, V1_EXAM_ANSWERS, V1_EXAM_OPTIONS))
    try:
        with engine.connect() as c:
            c.execute(text("SET TRANSACTION READ ONLY"))
            attempts = [dict(r) for r in c.execute(text(q[0])).mappings()]
            answers = [dict(r) for r in c.execute(text(q[1])).mappings()]
            order = {r[0]: r[1] for r in c.execute(text(q[2]))}
            identities = ({r[0]: r[1] for r in c.execute(text(V1_EXAM_IDENTITIES))}
                          if kind == "exam" else None)
    finally:
        engine.dispose()
    return attempts, answers, order, identities


def read_v1_usernames(v1_url: str) -> dict[str, str]:
    engine = create_engine(v1_url)
    try:
        with engine.connect() as c:
            c.execute(text("SET TRANSACTION READ ONLY"))
            return {str(r[0]): r[1] for r in c.execute(text(
                "SELECT id, username FROM users WHERE username IS NOT NULL"))}
    finally:
        engine.dispose()


def filter_since(attempts: list[dict], answers: list[dict], since: str):
    cut = _utc(datetime.fromisoformat(since))
    kept = [a for a in attempts if _utc(a["created_at"]) >= cut]
    ids = {a["id"] for a in kept}
    return kept, [a for a in answers if a["attempt_id"] in ids]


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--v1-url", required=True, help="V1 database URL (read-only)")
    ap.add_argument("--kind", choices=("textbook", "exam"), default="textbook")
    ap.add_argument("--raw-dir", help="raw upstream exam.json tree (kind=exam)")
    ap.add_argument("--match-users-by-username", action="store_true",
                    help="map V1 users to v2 legacy users by username when ids differ")
    ap.add_argument("--since", help="only attempts created at/after this UTC time"
                    " (ISO, naive = UTC), e.g. when a V1 was rebuilt from a backup")
    ap.add_argument("--apply", action="store_true",
                    help="commit; default is a dry-run that rolls back")
    args = ap.parse_args(argv)
    if args.kind == "exam" and not args.raw_dir:
        ap.error("--raw-dir is required for --kind exam")
    from app.db.engine import get_engine
    attempts, answers, order, identities = read_v1(args.v1_url, args.kind)
    if args.since:
        attempts, answers = filter_since(attempts, answers, args.since)
    print(json.dumps(import_answers(
        get_engine(), attempts, answers, order, args.apply, kind=args.kind,
        identities=identities, raw_dir=args.raw_dir,
        v1_usernames=(read_v1_usernames(args.v1_url)
                      if args.match_users_by_username else None)),
        ensure_ascii=False, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
