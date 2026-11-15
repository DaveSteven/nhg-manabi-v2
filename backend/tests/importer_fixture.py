"""Synthetic Canonical package builder for importer tests.

Produces a minimal valid package: 1 exam, 2 sections, 2 layers, 2 question
types, 2 units (cloze with slots + single), 3 questions, 3 answer keys,
1 explanation, 1 asset, 2 provenance rows — plus helpers to mutate it for
negative tests.
"""
import hashlib
import json
import zipfile

RICHTEXT = {"format": "jlptgo-richtext-v1", "blocks": []}


def _text(t: str, marks=None) -> dict:
    c = {"type": "text", "text": t}
    if marks:
        c["marks"] = marks
    return c


def _slot(slot_id: str, label: str) -> dict:
    return {"type": "slot", "slot_id": slot_id,
            "children": [_text(f"（{label}）")]}


def make_records() -> dict[str, list[dict]]:
    exam = {
        "record_type": "exam", "schema_version": "2.0.0",
        "id": "JLPTGO-N5-TEST-EX", "level": "N5", "year": 2024, "month": 12,
        "title": "测试卷 N5", "kind": "past_exam", "full_audio_asset_id": None,
        "status": "draft",
    }
    sections = [
        {"record_type": "section", "schema_version": "2.0.0",
         "id": "JLPTGO-N5-TEST-EX-sec-grammar", "exam_id": "JLPTGO-N5-TEST-EX",
         "subject": "grammar", "position": 1, "title": "文法"},
        {"record_type": "section", "schema_version": "2.0.0",
         "id": "JLPTGO-N5-TEST-EX-sec-vocabulary", "exam_id": "JLPTGO-N5-TEST-EX",
         "subject": "vocabulary", "position": 2, "title": "文字・語彙"},
    ]
    question_types = [
        {"record_type": "question_type", "schema_version": "2.0.0",
         "id": "grammar_cloze", "source_type_code": 23, "subject": "grammar",
         "label_zh": "文法填空", "label_ja": "文法クイズ",
         "answer_mode": "single_choice", "default_unit_kind": "cloze",
         "_provisional": False},
        {"record_type": "question_type", "schema_version": "2.0.0",
         "id": "vocabulary_kanji_reading", "source_type_code": 11,
         "subject": "vocabulary", "label_zh": "汉字读音", "label_ja": "漢字読み",
         "answer_mode": "single_choice", "default_unit_kind": "single",
         "_provisional": False},
    ]
    layers = [
        {"record_type": "layer", "schema_version": "2.0.0",
         "id": "JLPTGO-N5-TEST-EX-ly-01", "exam_id": "JLPTGO-N5-TEST-EX",
         "section": "grammar", "question_type_id": "grammar_cloze",
         "position": 1, "display_label": "問題7",
         "instruction": {**RICHTEXT, "blocks": [
             {"type": "paragraph", "children": [_text("＿＿＿＿に入れるものをえらびなさい。")]}]}},
        {"record_type": "layer", "schema_version": "2.0.0",
         "id": "JLPTGO-N5-TEST-EX-ly-02", "exam_id": "JLPTGO-N5-TEST-EX",
         "section": "vocabulary", "question_type_id": "vocabulary_kanji_reading",
         "position": 1, "display_label": "問題1",
         "instruction": {**RICHTEXT, "blocks": [
             {"type": "paragraph", "children": [_text("問題1 ___ の言葉の読み方をえらびなさい。")]}]}},
    ]
    cloze_material = {
        "id": "JLPTGO-N5-TEST-EX-ly-01-u01-m01", "kind": "passage",
        "role": "primary", "language": "ja-JP",
        "content": {**RICHTEXT, "blocks": [
            {"type": "paragraph", "children": [
                _text("彼は"), _slot("JLPTGO-N5-TEST-EX-ly-01-u01-s01", " 31 "),
                _text("と言った。"),
            ]},
            {"type": "paragraph", "children": [
                _text("そして"), _slot("JLPTGO-N5-TEST-EX-ly-01-u01-s02", " 32 "),
                _text("。"),
            ]},
        ]},
        "asset_id": None, "cues": None, "translated_from_material_id": None,
    }
    units = [
        {"record_type": "unit", "schema_version": "2.0.0",
         "id": "JLPTGO-N5-TEST-EX-ly-01-u01", "layer_id": "JLPTGO-N5-TEST-EX-ly-01",
         "question_type_id": "grammar_cloze", "kind": "cloze", "position": 1,
         "label": None, "materials": [cloze_material],
         "slot_ids": ["JLPTGO-N5-TEST-EX-ly-01-u01-s01",
                      "JLPTGO-N5-TEST-EX-ly-01-u01-s02"],
         "conversion_status": "complete"},
        {"record_type": "unit", "schema_version": "2.0.0",
         "id": "JLPTGO-N5-TEST-EX-ly-02-u01", "layer_id": "JLPTGO-N5-TEST-EX-ly-02",
         "question_type_id": "vocabulary_kanji_reading", "kind": "single",
         "position": 1, "label": None, "materials": [],
         "slot_ids": [], "conversion_status": "complete"},
    ]

    def options(qid: str, n: int = 3) -> list[dict]:
        return [
            {"id": f"{qid}-o{i}", "position": i,
             "content": {**RICHTEXT, "blocks": [
                 {"type": "paragraph", "children": [_text(f"選択肢{i}")]}]},
             "media_asset_ids": []}
            for i in range(1, n + 1)
        ]

    questions = [
        {"record_type": "question", "schema_version": "2.0.0",
         "id": "JLPTGO-N5-TEST-EX-ly-01-u01-q01",
         "unit_id": "JLPTGO-N5-TEST-EX-ly-01-u01",
         "question_type_id": "grammar_cloze", "position": 1,
         "printed_number": "31", "prompt": None,
         "slot_id": "JLPTGO-N5-TEST-EX-ly-01-u01-s01",
         "options": options("JLPTGO-N5-TEST-EX-ly-01-u01-q01"),
         "media_asset_ids": [], "conversion_status": "complete"},
        {"record_type": "question", "schema_version": "2.0.0",
         "id": "JLPTGO-N5-TEST-EX-ly-01-u01-q02",
         "unit_id": "JLPTGO-N5-TEST-EX-ly-01-u01",
         "question_type_id": "grammar_cloze", "position": 2,
         "printed_number": "32", "prompt": None,
         "slot_id": "JLPTGO-N5-TEST-EX-ly-01-u01-s02",
         "options": options("JLPTGO-N5-TEST-EX-ly-01-u01-q02"),
         "media_asset_ids": [], "conversion_status": "complete"},
        {"record_type": "question", "schema_version": "2.0.0",
         "id": "JLPTGO-N5-TEST-EX-ly-02-u01-q01",
         "unit_id": "JLPTGO-N5-TEST-EX-ly-02-u01",
         "question_type_id": "vocabulary_kanji_reading", "position": 1,
         "printed_number": "01",
         "prompt": {**RICHTEXT, "blocks": [
             {"type": "paragraph", "children": [
                 _text("山"), _text("に", ["underline"]), _text("のぼる。")]}]},
         "slot_id": None,
         "options": options("JLPTGO-N5-TEST-EX-ly-02-u01-q01"),
         "media_asset_ids": [], "conversion_status": "complete"},
    ]
    answer_keys = [
        {"record_type": "answer_key", "schema_version": "2.0.0",
         "question_id": "JLPTGO-N5-TEST-EX-ly-01-u01-q01", "revision": 1,
         "answer_mode": "single_choice",
         "correct_option_ids": ["JLPTGO-N5-TEST-EX-ly-01-u01-q01-o2"],
         "review_status": "unverified", "source_answer_index": 1},
        {"record_type": "answer_key", "schema_version": "2.0.0",
         "question_id": "JLPTGO-N5-TEST-EX-ly-01-u01-q02", "revision": 1,
         "answer_mode": "single_choice",
         "correct_option_ids": ["JLPTGO-N5-TEST-EX-ly-01-u01-q02-o1"],
         "review_status": "unverified", "source_answer_index": 0},
        {"record_type": "answer_key", "schema_version": "2.0.0",
         "question_id": "JLPTGO-N5-TEST-EX-ly-02-u01-q01", "revision": 1,
         "answer_mode": "single_choice",
         "correct_option_ids": ["JLPTGO-N5-TEST-EX-ly-02-u01-q01-o3"],
         "review_status": "unverified", "source_answer_index": 2},
    ]
    explanations = [
        {"record_type": "explanation", "schema_version": "2.0.0",
         "id": "JLPTGO-N5-TEST-EX-ly-01-u01-exp1", "owner_type": "unit",
         "owner_id": "JLPTGO-N5-TEST-EX-ly-01-u01", "kind": "translation",
         "language": "zh-CN",
         "content": {**RICHTEXT, "blocks": [
             {"type": "paragraph", "children": [_text("他说了……然后。")]}]},
         "revision": 1, "review_status": "unverified"},
    ]
    assets = [
        {"record_type": "media_asset", "schema_version": "2.0.0",
         "id": "JLPTGO-N5-TEST-EX-as001", "storage_key": "assets/test/a.mp3",
         "mime_type": "audio/mpeg", "sha256": "b" * 64, "size_bytes": 1024,
         "duration_ms": 30000, "availability": "unchecked"},
    ]
    return {
        "exam.json": [exam],
        "sections.jsonl": sections,
        "layers.jsonl": layers,
        "question_types.jsonl": question_types,
        "units.jsonl": units,
        "questions.jsonl": questions,
        "answer_keys.private.jsonl": answer_keys,
        "explanations.jsonl": explanations,
        "assets.jsonl": assets,
    }


def make_provenance() -> list[dict]:
    return [
        {"source_system": "test", "source_object_id": "src1",
         "source_identity": "test-1", "source_node_path": "layers[0].items[0]",
         "canonical_type": "question", "canonical_id": "JLPTGO-N5-TEST-EX-ly-02-u01-q01",
         "raw_node_hash": "c" * 64, "transform_version": "test+0.1"},
        {"source_system": "test", "source_object_id": "src2",
         "source_identity": "test-2", "source_node_path": "layers[1].items[0]",
         "canonical_type": "question", "canonical_id": "JLPTGO-N5-TEST-EX-ly-01-u01-q01",
         "raw_node_hash": "d" * 64, "transform_version": "test+0.1"},
    ]


def build_manifest(records: dict, provenance: list[dict],
                   package_id: str = "JLPTGO-N5-TEST-EX-r1") -> dict:
    files = []
    counts = {
        "sections": len(records["sections.jsonl"]),
        "layers": len(records["layers.jsonl"]),
        "units": len(records["units.jsonl"]),
        "questions": len(records["questions.jsonl"]),
        "assets": len(records["assets.jsonl"]),
        "explanations": len(records["explanations.jsonl"]),
    }
    for filename, rows in records.items():
        if filename == "exam.json":
            raw = json.dumps(rows[0], ensure_ascii=False, indent=2).encode("utf-8")
        else:
            raw = ("\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n").encode("utf-8")
        files.append({"path": filename, "bytes": len(raw),
                      "sha256": hashlib.sha256(raw).hexdigest()})
    return {
        "record_type": "manifest", "schema_version": "2.0.0",
        "package_id": package_id, "exam_id": "JLPTGO-N5-TEST-EX",
        "release_id": None, "content_hash": None, "counts": counts,
        "files": files, "source_archive_sha256": "e" * 64,
        "conversion_version": "test-converter+0.1", "state": "draft",
    }


def write_zip(records: dict, provenance: list[dict], path) -> str:
    manifest = build_manifest(records, provenance)
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("JLPTGO-N5-TEST-EX-r1/manifest.json",
                   json.dumps(manifest, ensure_ascii=False, indent=2))
        for filename, rows in records.items():
            if filename == "exam.json":
                raw = json.dumps(rows[0], ensure_ascii=False, indent=2)
            else:
                raw = "\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n"
            z.writestr(f"JLPTGO-N5-TEST-EX-r1/{filename}", raw)
        z.writestr("JLPTGO-N5-TEST-EX-r1/provenance/source_refs.private.jsonl",
                   "\n".join(json.dumps(p, ensure_ascii=False) for p in provenance) + "\n")
    return "JLPTGO-N5-TEST-EX-r1/"
