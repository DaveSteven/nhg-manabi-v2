"""M2.3 E2E seed: synthetic N2-shaped exam into an ISOLATED database.

Builds a synthetic Canonical package (NOT real, unreviewed content) that
mirrors the N2 structures M2.3 must exercise, then runs it through the full
publish gate (stage -> publish -> human_reviewed -> rights -> promote) in the
isolated `<DB>_e2e` database. The real development DB is never touched, and
no real exam content is published.

Structures:
- vocabulary 問題1  : single Unit, 1 Question
- grammar    問題9  : 1 cloze Unit, 5 Questions, 5 slots
- reading    問題11 : 3 passage Units (each its own Unit, 2 Questions)
- listening  課題1  : 1 audio Unit (real mp3 + cues), 2 Questions

`--revision 2` builds a second release of the same exam with changed content
(new content_hash) to verify old sessions keep pointing at the old release.

Usage (from backend/, with .env sourced):
    python ../scripts/e2e_seed_n2.py [--revision 1|2]
Prints a JSON summary (release_id, unit ids, storage dir, db url without password).
"""
import argparse
import json
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(BACKEND / "tests"))

from sqlalchemy import create_engine, text  # noqa: E402
from sqlalchemy.engine import make_url  # noqa: E402

EXAM = "JLPTGO-N2-E2E-EX"
PACKAGE_PREFIX = f"{EXAM}-r"
RT = "jlptgo-richtext-v1"
STORAGE_DIR = Path(os.environ.get("MEDIA_STORAGE_DIR", "/tmp/nhg-e2e-media"))


def t(s, marks=None):
    n = {"type": "text", "text": s}
    if marks:
        n["marks"] = marks
    return n


def para(*children):
    return {"type": "paragraph", "children": list(children)}


def rich(*blocks):
    return {"format": RT, "blocks": list(blocks)}


def slot(sid, label):
    return {"type": "slot", "slot_id": sid, "children": [t(f"（{label}）")]}


def options(qid, correct_pos, n=4, label="選択肢"):
    return [{"id": f"{qid}-o{i}", "position": i,
             "content": rich(para(t(f"{label}{i}"))), "media_asset_ids": []}
            for i in range(1, n + 1)], f"{qid}-o{correct_pos}"


def build(revision: int, mp3_sha: str, mp3_size: int):
    suffix = "" if revision == 1 else "（改訂）"
    recs = {k: [] for k in (
        "exam.json", "sections.jsonl", "layers.jsonl", "question_types.jsonl",
        "units.jsonl", "questions.jsonl", "answer_keys.private.jsonl",
        "explanations.jsonl", "assets.jsonl")}
    recs["exam.json"] = [{
        "record_type": "exam", "schema_version": "2.0.0", "id": EXAM,
        "level": "N2", "year": 2099, "month": 12,
        "title": "E2E 合成卷 N2（非真实内容）", "kind": "past_exam",
        "full_audio_asset_id": None, "status": "draft"}]
    for pos, subj, title in ((1, "vocabulary", "文字・語彙"), (2, "grammar", "文法"),
                             (3, "reading", "読解"), (4, "listening", "聴解")):
        recs["sections.jsonl"].append({
            "record_type": "section", "schema_version": "2.0.0",
            "id": f"{EXAM}-sec-{subj}", "exam_id": EXAM, "subject": subj,
            "position": pos, "title": title})
    qtypes = [
        ("e2e_vocab_reading", 9101, "vocabulary", "汉字读音", "single"),
        ("e2e_grammar_cloze", 9102, "grammar", "文章文法", "cloze"),
        ("e2e_reading_mid", 9103, "reading", "中文读解", "passage"),
        ("e2e_listening_task", 9104, "listening", "课题理解", "audio")]
    for qid, code, subj, zh, kind in qtypes:
        recs["question_types.jsonl"].append({
            "record_type": "question_type", "schema_version": "2.0.0",
            "id": qid, "source_type_code": code, "subject": subj,
            "label_zh": zh, "label_ja": zh, "answer_mode": "single_choice",
            "default_unit_kind": kind, "_provisional": False})
    for i, (subj, qt, label) in enumerate((
            ("vocabulary", "e2e_vocab_reading", "問題1"),
            ("grammar", "e2e_grammar_cloze", "問題9"),
            ("reading", "e2e_reading_mid", "問題11"),
            ("listening", "e2e_listening_task", "課題1")), start=1):
        recs["layers.jsonl"].append({
            "record_type": "layer", "schema_version": "2.0.0",
            "id": f"{EXAM}-ly-{i:02d}", "exam_id": EXAM, "section": subj,
            "question_type_id": qt, "position": 1, "display_label": label,
            "instruction": rich(para(t(f"{label} 合成指示文。")))})

    def add_unit(ly, qt, kind, uid, materials, slot_ids, qdefs, expl):
        recs["units.jsonl"].append({
            "record_type": "unit", "schema_version": "2.0.0", "id": uid,
            "layer_id": f"{EXAM}-ly-{ly:02d}", "question_type_id": qt,
            "kind": kind, "position": int(uid.rsplit("u", 1)[1]), "label": None,
            "materials": materials, "slot_ids": slot_ids,
            "conversion_status": "complete"})
        for n, (printed, prompt, slot_id, correct) in enumerate(qdefs, start=1):
            qid = f"{uid}-q{n:02d}"
            opts, correct_id = options(qid, correct)
            recs["questions.jsonl"].append({
                "record_type": "question", "schema_version": "2.0.0", "id": qid,
                "unit_id": uid, "question_type_id": qt, "position": n,
                "printed_number": printed, "prompt": prompt, "slot_id": slot_id,
                "options": opts, "media_asset_ids": [],
                "conversion_status": "complete"})
            recs["answer_keys.private.jsonl"].append({
                "record_type": "answer_key", "schema_version": "2.0.0",
                "question_id": qid, "revision": 1,
                "answer_mode": "single_choice",
                "correct_option_ids": [correct_id],
                "review_status": "unverified", "source_answer_index": correct - 1})
        recs["explanations.jsonl"].append({
            "record_type": "explanation", "schema_version": "2.0.0",
            "id": f"{uid}-exp1", "owner_type": "unit", "owner_id": uid,
            "kind": "analysis", "language": "zh-CN",
            "content": rich(para(t(f"解析：{expl}{suffix}"))),
            "revision": 1, "review_status": "unverified"})

    # 1. vocabulary 問題1: single unit
    add_unit(1, "e2e_vocab_reading", "single", f"{EXAM}-ly-01-u01", [], [],
             [("1", rich(para(t("彼は"), t("経験", ["underline"]),
                               t(f"が豊富だ。{suffix}"))), None, 2)],
             "「経験」读作けいけん。")
    # 2. grammar 問題9: 1 cloze unit, 5 questions
    u = f"{EXAM}-ly-02-u01"
    sids = [f"{u}-s{i:02d}" for i in range(1, 6)]
    passage = rich(
        para(t("日本の夏は"), slot(sids[0], "46"), t("暑いが、"), slot(sids[1], "47"),
             t("過ごしやすい。")),
        para(slot(sids[2], "48"), t("、"), slot(sids[3], "49"), t("ことで、"),
             slot(sids[4], "50"), t(f"。{suffix}")))
    add_unit(2, "e2e_grammar_cloze", "cloze", u,
             [{"id": f"{u}-m01", "kind": "passage", "role": "primary",
               "language": "ja-JP", "content": passage, "asset_id": None,
               "cues": None, "translated_from_material_id": None}], sids,
             [(str(46 + i), None, sids[i], c) for i, c in enumerate((1, 2, 3, 4, 1))],
             "5 个空位分别对应 46–50。")
    # 3. reading 問題11: three independent passage units
    for n in (1, 2, 3):
        u = f"{EXAM}-ly-03-u{n:02d}"
        add_unit(3, "e2e_reading_mid", "passage", u,
                 [{"id": f"{u}-m01", "kind": "passage", "role": "primary",
                   "language": "ja-JP",
                   "content": rich(para(t(f"文章{n}：これは合成の読解文です。{suffix}"))),
                   "asset_id": None, "cues": None,
                   "translated_from_material_id": None}], [],
                 [(str(50 + 2 * n - 1), rich(para(t(f"文章{n}の問い1"))), None, n),
                  (str(50 + 2 * n), rich(para(t(f"文章{n}の問い2"))), None, 5 - n - 1 or 1)],
                 f"文章{n}的解析。")
    # 4. listening: audio unit with real mp3 + cues
    u = f"{EXAM}-ly-04-u01"
    recs["assets.jsonl"].append({
        "record_type": "media_asset", "schema_version": "2.0.0",
        "id": f"{EXAM}-as001", "storage_key": "assets/e2e/a.mp3",
        "mime_type": "audio/mpeg", "sha256": mp3_sha, "size_bytes": mp3_size,
        "duration_ms": 1000, "availability": "unchecked"})
    add_unit(4, "e2e_listening_task", "audio", u,
             [{"id": f"{u}-m-audio", "kind": "audio", "role": "primary",
               "language": "ja-JP", "content": None, "asset_id": f"{EXAM}-as001",
               "cues": [{"index": 1, "start_ms": 0, "end_ms": 500,
                         "text": rich(para(t("女：もしもし。")))},
                        {"index": 2, "start_ms": 500, "end_ms": 1000,
                         "text": rich(para(t("男：はい。")))}],
               "translated_from_material_id": None}], [],
             [("1", rich(para(t("男の人はどうしますか。"))), None, 2),
              ("2", rich(para(t("女の人の希望は何ですか。"))), None, 3)],
             "听力解析。")
    prov = [{"source_system": "e2e", "source_object_id": "s1",
             "source_identity": "e2e-1", "source_node_path": "synthetic",
             "canonical_type": "question",
             "canonical_id": f"{EXAM}-ly-01-u01-q01", "raw_node_hash": "c" * 64,
             "transform_version": "e2e+0.1"}]
    return recs, prov


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--revision", type=int, default=1, choices=(1, 2))
    args = ap.parse_args()

    base = make_url(os.environ["DATABASE_URL"])
    db_name = base.database + "_e2e"
    e2e_url = base.set(database=db_name).render_as_string(hide_password=False)
    admin = create_engine(base.set(database="postgres"), isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        exists = conn.execute(text("SELECT 1 FROM pg_database WHERE datname=:d"),
                              {"d": db_name}).scalar()
        if not exists:
            conn.execute(text(f'CREATE DATABASE "{db_name}"'))
    admin.dispose()
    from alembic import command
    from alembic.config import Config
    prev = os.environ["DATABASE_URL"]
    os.environ["DATABASE_URL"] = e2e_url
    try:
        command.upgrade(Config(str(BACKEND / "alembic.ini")), "head")
    finally:
        os.environ["DATABASE_URL"] = prev
    engine = create_engine(e2e_url)

    from media_sample import TINY_MP3_BYTES, TINY_MP3_SHA256
    from importer_fixture import write_zip
    import importer_fixture as fx
    from app.importer.reader import load_archive
    from app.importer.staging import stage_package
    from app.publisher import confirm_rights, promote_release, publish_package

    recs, prov = build(args.revision, TINY_MP3_SHA256, len(TINY_MP3_BYTES))
    package_id = f"{PACKAGE_PREFIX}{args.revision}"
    # write_zip/build_manifest hardcode the fixture ids; patch for this package.
    orig = fx.build_manifest

    def manifest(records, provenance, package_id_=package_id):
        m = orig(records, provenance, package_id_)
        m["exam_id"] = EXAM
        return m
    fx.build_manifest = manifest
    with tempfile.TemporaryDirectory() as tmp:
        zpath = os.path.join(tmp, "pkg.zip")
        prefix = write_zip(recs, prov, zpath)
        # rewrite folder prefix to package id
        import zipfile
        out = os.path.join(tmp, "pkg2.zip")
        with zipfile.ZipFile(zpath) as zi, zipfile.ZipFile(out, "w") as zo:
            for item in zi.infolist():
                zo.writestr(item.filename.replace(prefix, f"{package_id}/", 1),
                            zi.read(item.filename))
        stage_package(engine, load_archive(Path(out))[0])
    res = publish_package(engine, package_id)
    rid = res["release_id"]
    with engine.begin() as conn:
        conn.execute(text("UPDATE release_answer_keys SET review_status ="
                          " 'human_reviewed' WHERE release_id = :r"), {"r": rid})
        conn.execute(text("UPDATE media_assets SET availability = 'verified'"
                          " WHERE id = :a"), {"a": f"{EXAM}-as001"})
    # Real file, content-addressed, through the same layout the API reads.
    from app.media_sync import storage_rel_path
    target = STORAGE_DIR / storage_rel_path(TINY_MP3_SHA256, "audio/mpeg")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(TINY_MP3_BYTES)
    with engine.begin() as conn:
        conn.execute(text(
            "INSERT INTO media_storage (asset_id, state, stored_sha256,"
            " stored_size_bytes, stored_mime_type, verified_duration_ms,"
            " source_system, rule_version) VALUES (:a, 'stored', :s, :z,"
            " 'audio/mpeg', 1000, 'e2e_seed', 'e2e') ON CONFLICT (asset_id)"
            " DO NOTHING"),
            {"a": f"{EXAM}-as001", "s": TINY_MP3_SHA256, "z": len(TINY_MP3_BYTES)})
    confirm_rights(engine, EXAM, reviewer_id="e2e-seed")
    promote_release(engine, rid, reviewer_id="e2e-seed")
    print(json.dumps({
        "exam_id": EXAM, "release_id": rid, "revision": args.revision,
        "storage_dir": str(STORAGE_DIR), "database": db_name,
        "units": [u["id"] for u in recs["units.jsonl"]]}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
