"""Convert JLPT GO 1.0 textbook questions into Canonical v2.0 packages
(ADR-0030 「扩展练习」/ supplementary).

One V1 `book` (= one lesson, 10 questions) becomes one package: an Exam with
kind `supplementary` (no year/month), one Section, one Layer per question
type, and one `single` Unit per question. Nothing is silently fixed:
questions that cannot be converted safely are either excluded (reported) or
kept with conversion_status `needs_review` (hidden from students until
reviewed). V1 has no explanations and answers are unverified.

V1 is read-only. Packages are written to --out; staging/publishing is the
normal importer (`python -m app.importer <dir>`).

  python -m app.v1_book_convert --v1-url postgresql+psycopg://... --out DIR \
      [--book-id N] [--limit N]
"""
import argparse
import hashlib
import json
import re
from pathlib import Path

SCHEMA_VERSION = "2.0.0"
TRANSFORM_VERSION = "v1-books-converter+0.1"
RICHTEXT = "jlptgo-richtext-v1"

SUBJECTS = {  # V1 subject_label -> (slug, canonical section subject)
    "漢字": ("kanji", "vocabulary"),
    "語彙": ("vocabulary", "vocabulary"),
    "文法": ("grammar", "grammar"),
}
SECTION_TITLE = {"vocabulary": "文字・語彙", "grammar": "文法"}

QUESTION_TYPES = {
    "vocabulary_kanji_reading": dict(source_type_code=11, subject="vocabulary", label_zh="汉字读音", label_ja="漢字読み"),
    "vocabulary_orthography": dict(source_type_code=12, subject="vocabulary", label_zh="汉字书写", label_ja="表記"),
    "vocabulary_context": dict(source_type_code=13, subject="vocabulary", label_zh="语境填空", label_ja="文脈規定"),
    "grammar_form": dict(source_type_code=21, subject="grammar", label_zh="语法形式判断", label_ja="文の文法１（文法形式）"),
}
INSTRUCTION = {
    "vocabulary_kanji_reading": "____の言葉の読み方として最もよいものを、1・2・3・4から一つ選びなさい。",
    "vocabulary_orthography": "____の言葉を漢字で書くとき、最もよいものを、1・2・3・4から一つ選びなさい。",
    "vocabulary_context": "（　　　）に入れるのに最もよいものを、1・2・3・4から一つ選びなさい。",
    "grammar_form": "（　　　）に入れるのに最もよいものを、1・2・3・4から一つ選びなさい。",
}

# Human-approved repairs of broken V1 data (user decision 2026-11-19, ADR-0030).
# Keyed by V1 question id. A fix applies only while the V1 row still looks
# exactly like `expect_stem`/`expect_options` (otherwise it is reported and the
# question is left unconverted for review) — never a blind override.
MANUAL_FIXES = {
    2326: dict(
        reason="V1 把「10分の…」从题干拆进了选项表，且正确答案误标为「長所」；"
               "还原题干，答案按语义改为「距離」",
        expect_stem="会社まで車で",
        expect_options=["0分の【　　　】だ。", "性格", "長所", "距離", "連絡"],
        prompt="会社まで車で10分の【　　　】だ。",
        options=["性格", "長所", "距離", "連絡"], correct=2),
    1758: dict(
        reason="V1 选项「出そう」重复且两个都标为正确；去重，保留「出そう」为正确",
        expect_stem="みんなで遊びに行くとき、いつも田中さんは自分からお金を【　　　】としない。",
        expect_options=["出そう", "出そう", "出よう", "出しよう"],
        prompt=None, options=["出そう", "出よう", "出しよう"], correct=0),
}

# V1 questions that genuinely have 3 options; content checked and approved by
# the user 2026-11-19 (others with a non-4 option count stay needs_review).
APPROVED_THREE_OPTIONS = {405, 419, 632, 781, 794, 1758, 2689, 2812}

_LESSON_RE = re.compile(r"第\s*(\d+)\s*课")
_BRACKET_RE = re.compile(r"【([^】]*)】")
_OPT_LINE_RE = re.compile(r"^\s*([1-4１-４])\s*[\.．、]\s*(.+?)\s*$")
_PLACEHOLDER = {"1", "2", "3", "4"}
_KANJI_RE = re.compile(r"[一-龯々〆ヶ]")
_FW = str.maketrans("１２３４", "1234")


def lesson_number(name: str) -> int | None:
    m = _LESSON_RE.search(name or "")
    return int(m.group(1)) if m else None


def split_stem(stem: str) -> tuple[str, list[str]]:
    """Separate an in-stem option list ("1.xx\\n2.yy…") from the prompt."""
    lines = (stem or "").replace("\r", "").split("\n")
    first = next((i for i, l in enumerate(lines) if _OPT_LINE_RE.match(l)), None)
    if first is None:
        return (stem or "").strip(), []
    prompt = "\n".join(lines[:first]).strip()
    opts = []
    for l in lines[first:]:
        m = _OPT_LINE_RE.match(l)
        if m:
            opts.append(m.group(2))
    return prompt, opts


_RUBY_RE = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")


def _plain_ruby(t: str) -> str:
    """V1 writes furigana as [漢](かん); kept as visible 漢(かん) text (the
    richtext ruby node has no defined shape yet)."""
    return _RUBY_RE.sub(r"\1(\2)", t)


def split_inline_options(stem: str) -> tuple[str, list[str]]:
    """Options written inline in the stem: "…。1.舌が回る2.かみ砕く3.溶ける4.味わう"
    (also "1.A2B" without a dot, or split over lines). Exactly four
    non-empty options in order 1..4, else no parse."""
    s = (stem or "").replace("\r", "").replace("\n", " ")
    m1 = re.search(r"(?<![0-9])[1１][\.．]", s)
    if m1 is None:
        return (stem or "").strip(), []
    spans, pos = [m1], m1.end()
    for k in "234":
        m = (re.compile(rf"(?<![0-9]){k}[\.．](?![0-9])").search(s, pos)
             or re.compile(rf"(?<![0-9]){k}(?![0-9])").search(s, pos))
        if m is None:
            return (stem or "").strip(), []
        spans.append(m)
        pos = m.end()
    ends = [m.start() for m in spans[1:]] + [len(s)]
    opts = [s[m.end():e].strip() for m, e in zip(spans, ends)]
    if any(not o for o in opts):
        return (stem or "").strip(), []
    return s[:m1.start()].strip(), opts


def _text(t: str, marks=None) -> dict:
    c = {"type": "text", "text": t}
    if marks:
        c["marks"] = marks
    return c


def prompt_richtext(prompt: str) -> dict:
    """【　　　】 blank -> （　　　）; 【word】 -> underlined word."""
    children, pos = [], 0
    for m in _BRACKET_RE.finditer(prompt):
        if m.start() > pos:
            children.append(_text(prompt[pos:m.start()]))
        inner = m.group(1)
        children.append(_text("（　　　）") if not inner.strip()
                        else _text(inner, ["underline"]))
        pos = m.end()
    if pos < len(prompt):
        children.append(_text(prompt[pos:]))
    return {"format": RICHTEXT, "blocks": [
        {"type": "paragraph", "children": children or [_text("")]}]}


def option_richtext(text: str) -> dict:
    return {"format": RICHTEXT, "blocks": [
        {"type": "paragraph", "children": [_text(_plain_ruby(text.strip()))]}]}


def classify(subject_label: str, prompt: str) -> str | None:
    if subject_label == "文法":
        return "grammar_form"
    if subject_label == "語彙":
        return "vocabulary_context"
    if subject_label == "漢字":
        words = [m.group(1) for m in _BRACKET_RE.finditer(prompt) if m.group(1).strip()]
        if not words:
            return None
        return ("vocabulary_kanji_reading"
                if any(_KANJI_RE.search(w) for w in words)
                else "vocabulary_orthography")
    return None


def _hash(obj) -> str:
    return hashlib.sha256(json.dumps(obj, ensure_ascii=False, sort_keys=True,
                                     default=str).encode("utf-8")).hexdigest()


def build_package(book: dict, questions: list[dict], options: dict[int, list[dict]]):
    """Return (records, provenance, report) for one V1 book, or
    (None, [], report) when the book cannot be converted at all."""
    report = {"book_id": book["id"], "name": book["name"], "excluded": [],
              "needs_review": [], "manual_fixes": [], "converted": 0}
    slug_info = SUBJECTS.get(book["subject_label"])
    lesson = lesson_number(book["name"])
    if slug_info is None or lesson is None or book["level"] not in {"N1", "N2", "N3", "N4", "N5"}:
        report["excluded"].append({"reason": "unsupported_book"})
        return None, [], report
    slug, section_subject = slug_info
    exam_id = f"JLPTGO-SUP-{book['level']}-{slug}-L{lesson:03d}"
    section_id = f"{exam_id}-sec-{section_subject}"

    converted = []  # (question_row, type_id, prompt_text, option_texts, status, correct_idx)
    fixed_ids = set()
    for q in sorted(questions, key=lambda r: (r.get("source_index") or 0, r["id"])):
        opts = sorted(options.get(q["id"], []), key=lambda o: o["source_order"])
        prompt, stem_opts = split_stem(q["stem"])
        texts = [o["text"] for o in opts]
        problems = []
        fix = MANUAL_FIXES.get(q["id"])
        if fix is not None:
            if q["stem"] == fix["expect_stem"] and texts == fix["expect_options"]:
                prompt = fix["prompt"] or prompt
                texts = list(fix["options"])
                opts = [dict(text=t, is_correct=int(i == fix["correct"]), source_order=i)
                        for i, t in enumerate(texts)]
                fixed_ids.add(q["id"])
                report["manual_fixes"].append({"question_id": q["id"], "reason": fix["reason"]})
            else:
                report["excluded"].append({"question_id": q["id"], "reason": "manual_fix_stale"})
                continue
        if texts and all(t.strip() in _PLACEHOLDER for t in texts):
            if len(stem_opts) != len(texts):   # not one option per line: try inline
                prompt, stem_opts = split_inline_options(q["stem"])
            if len(stem_opts) == len(texts):
                texts = stem_opts          # real option text lives in the stem
            else:
                problems.append("options_unparsed")
        if not prompt:
            report["excluded"].append({"question_id": q["id"], "reason": "empty_prompt"})
            continue
        correct = [i for i, o in enumerate(opts) if o["is_correct"] == 1]
        if len(correct) != 1:
            report["excluded"].append({"question_id": q["id"],
                                       "reason": f"correct_answers={len(correct)}"})
            continue
        if len(texts) < 2 or any(not t.strip() for t in texts):
            report["excluded"].append({"question_id": q["id"], "reason": "bad_options"})
            continue
        type_id = classify(book["subject_label"], prompt)
        if type_id is None:
            problems.append("type_unclassified")
            type_id = {"漢字": "vocabulary_kanji_reading"}.get(book["subject_label"])
        if len(texts) != 4 and not (q["id"] in APPROVED_THREE_OPTIONS and len(texts) == 3):
            problems.append(f"option_count={len(texts)}")
        status = "needs_review" if problems else "complete"
        if problems:
            report["needs_review"].append({"question_id": q["id"], "issues": problems})
        converted.append((q, type_id, prompt, texts, status, correct[0]))

    if not converted:
        report["excluded"].append({"reason": "no_convertible_questions"})
        return None, [], report

    type_order = list(dict.fromkeys(t for _, t, *_ in converted))
    S = lambda rt, **kw: {"record_type": rt, "schema_version": SCHEMA_VERSION, **kw}
    records = {
        "exam.json": [S("exam", id=exam_id, level=book["level"], year=None, month=None,
                        title=f"{book['subject_label']}・{book['name']}",
                        kind="supplementary", full_audio_asset_id=None, status="draft")],
        "sections.jsonl": [S("section", id=section_id, exam_id=exam_id,
                             subject=section_subject, position=1,
                             title=SECTION_TITLE[section_subject])],
        "question_types.jsonl": [S("question_type", id=t, **QUESTION_TYPES[t],
                                   answer_mode="single_choice",
                                   default_unit_kind="single", _provisional=False)
                                 for t in type_order],
        "layers.jsonl": [], "units.jsonl": [], "questions.jsonl": [],
        "answer_keys.private.jsonl": [], "explanations.jsonl": [], "assets.jsonl": [],
    }
    layer_ids = {}
    for pos, t in enumerate(type_order, 1):
        lid = f"{exam_id}-ly-{pos:02d}"
        layer_ids[t] = lid
        records["layers.jsonl"].append(S(
            "layer", id=lid, exam_id=exam_id, section=section_subject,
            question_type_id=t, position=pos, display_label=book["name"],
            instruction={"format": RICHTEXT, "blocks": [
                {"type": "paragraph", "children": [_text(INSTRUCTION[t])]}]}))
    unit_pos = {t: 0 for t in type_order}
    provenance = []
    for q, t, prompt, texts, status, correct_idx in converted:
        unit_pos[t] += 1
        uid = f"{layer_ids[t]}-u{unit_pos[t]:02d}"
        qid = f"{uid}-q01"
        records["units.jsonl"].append(S(
            "unit", id=uid, layer_id=layer_ids[t], question_type_id=t, kind="single",
            position=unit_pos[t], label=None, materials=[], slot_ids=[],
            conversion_status=status))
        option_ids = [f"{qid}-o{i}" for i in range(1, len(texts) + 1)]
        records["questions.jsonl"].append(S(
            "question", id=qid, unit_id=uid, question_type_id=t, position=1,
            printed_number=f"{len(records['questions.jsonl']) + 1:02d}",
            prompt=prompt_richtext(prompt), slot_id=None, media_asset_ids=[],
            conversion_status=status,
            options=[{"id": option_ids[i], "position": i + 1,
                      "content": option_richtext(tx), "media_asset_ids": []}
                     for i, tx in enumerate(texts)]))
        records["answer_keys.private.jsonl"].append(S(
            "answer_key", question_id=qid, revision=1, answer_mode="single_choice",
            correct_option_ids=[option_ids[correct_idx]], review_status="unverified",
            source_answer_index=correct_idx))
        provenance.append({
            "source_system": "jlptgo-v1-book", "source_object_id": str(q["id"]),
            "source_identity": q.get("external_id"), "source_node_path": f"books[{book['id']}]",
            "canonical_type": "question", "canonical_id": qid,
            "raw_node_hash": _hash([q, options.get(q["id"], [])]),
            "transform_version": TRANSFORM_VERSION,
            **({"manual_fix": MANUAL_FIXES[q["id"]]["reason"]} if q["id"] in fixed_ids else {})})
    report["converted"] = len(converted)
    return records, provenance, report


def _file_bytes(name: str, rows: list[dict]) -> bytes:
    if name == "exam.json":
        return json.dumps(rows[0], ensure_ascii=False, indent=2).encode("utf-8")
    return ("\n".join(json.dumps(r, ensure_ascii=False) for r in rows)
            + ("\n" if rows else "")).encode("utf-8")


def write_package(out_dir: Path, records: dict, provenance: list[dict]) -> Path:
    exam_id = records["exam.json"][0]["id"]
    package_id = f"{exam_id}-r1"
    pkg = Path(out_dir) / package_id
    (pkg / "provenance").mkdir(parents=True, exist_ok=True)
    files = []
    for name, rows in records.items():
        raw = _file_bytes(name, rows)
        (pkg / name).write_bytes(raw)
        files.append({"path": name, "sha256": hashlib.sha256(raw).hexdigest(),
                      "bytes": len(raw)})
    (pkg / "provenance" / "source_refs.private.jsonl").write_bytes(
        _file_bytes("provenance", provenance))
    manifest = {
        "record_type": "manifest", "schema_version": SCHEMA_VERSION,
        "package_id": package_id, "exam_id": exam_id, "release_id": None,
        "content_hash": None, "state": "draft",
        "counts": {"sections": len(records["sections.jsonl"]),
                   "layers": len(records["layers.jsonl"]),
                   "units": len(records["units.jsonl"]),
                   "questions": len(records["questions.jsonl"]),
                   "assets": 0, "explanations": 0},
        "files": files, "source_archive_sha256": _hash(provenance),
        "conversion_version": TRANSFORM_VERSION}
    (pkg / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return pkg


def read_v1(v1_url: str, book_id: int | None, limit: int | None):
    from sqlalchemy import create_engine, text
    engine = create_engine(v1_url)
    try:
        with engine.connect() as c:
            c.execute(text("SET TRANSACTION READ ONLY"))
            books = [dict(r) for r in c.execute(text(
                "SELECT id, name, level, subject, subject_label FROM books"
                + (" WHERE id = :b" if book_id else "") + " ORDER BY id"
                + (f" LIMIT {int(limit)}" if limit else "")),
                {"b": book_id} if book_id else {}).mappings()]
            ids = [b["id"] for b in books]
            qs = [dict(r) for r in c.execute(text(
                "SELECT id, external_id, book_id, stem, source_index FROM questions"
                " WHERE book_id = ANY(:ids)"), {"ids": ids}).mappings()]
            opts = [dict(r) for r in c.execute(text(
                "SELECT question_id, text, is_correct, source_order FROM options"
                " WHERE question_id IN (SELECT id FROM questions WHERE book_id = ANY(:ids))"),
                {"ids": ids}).mappings()]
    finally:
        engine.dispose()
    return books, qs, opts


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--v1-url", required=True)
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--book-id", type=int)
    ap.add_argument("--limit", type=int)
    args = ap.parse_args(argv)
    books, qs, opts = read_v1(args.v1_url, args.book_id, args.limit)
    by_book, by_q = {}, {}
    for q in qs:
        by_book.setdefault(q["book_id"], []).append(q)
    for o in opts:
        by_q.setdefault(o["question_id"], []).append(o)
    reports, written = [], 0
    for b in books:
        records, prov, rep = build_package(b, by_book.get(b["id"], []), by_q)
        if records is not None:
            write_package(args.out, records, prov)
            written += 1
        reports.append(rep)
    summary = {"books": len(books), "packages_written": written,
               "questions_converted": sum(r["converted"] for r in reports),
               "manual_fixes": [f for r in reports for f in r["manual_fixes"]],
               "excluded": [r for r in reports if r["excluded"]],
               "needs_review": [r for r in reports if r["needs_review"]]}
    print(json.dumps(summary, ensure_ascii=False, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
