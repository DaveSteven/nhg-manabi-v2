"""Render an exam release to Word (.docx): question paper + answers/explanations.

Shared by the admin export endpoint (data read from a Release in PostgreSQL)
and scripts/export_exam_docx.py (data read from a normalized package dir).
Both are loaded into the same neutral ``ExamData`` shape, which mirrors the
Canonical v2.0 record layout so the renderer does not care about the source.
"""
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.oxml.ns import qn
from docx.shared import Cm, Pt

FONT = "Noto Serif JP"
GOOD_REVIEW = ("agent_verified", "human_reviewed")


def set_font(run, size=None, bold=None):
    run.font.name = FONT
    run._element.rPr.rFonts.set(qn("w:eastAsia"), FONT)
    if size:
        run.font.size = Pt(size)
    if bold is not None:
        run.bold = bold


def new_doc() -> Document:
    doc = Document()
    sec = doc.sections[0]
    sec.page_width, sec.page_height = Cm(21), Cm(29.7)
    sec.left_margin = sec.right_margin = Cm(1.27)
    sec.top_margin = sec.bottom_margin = Cm(1.27)
    sec.header_distance = sec.footer_distance = Cm(0.6)
    for name in ("Normal", "Heading 1", "Heading 2", "Heading 3", "Title"):
        st = doc.styles[name]
        st.font.name = FONT
        st.element.get_or_add_rPr().get_or_add_rFonts().set(qn("w:eastAsia"), FONT)
        st.font.color.rgb = None
    doc.styles["Normal"].font.size = Pt(11)
    # Noto Serif JP has tall line metrics; fix line height so lines stay compact
    pf = doc.styles["Normal"].paragraph_format
    pf.line_spacing = Pt(15)
    pf.space_before = pf.space_after = Pt(0)
    return doc


def add_rich(par, content: dict | None, bold=False):
    """Append jlptgo-richtext-v1 inline content to an existing paragraph (first block only)."""
    if not content:
        return
    blocks = content.get("blocks", [])
    for bi, block in enumerate(blocks):
        if bi:
            par.add_run().add_break()
        add_inline(par, block.get("children", []), bold)


def add_inline(par, children, bold=False):
    for ch in children:
        t = ch.get("type")
        if t == "text":
            r = par.add_run(ch.get("text", ""))
            marks = ch.get("marks") or []
            set_font(r, bold=bold or "bold" in marks)
            if "underline" in marks:
                r.underline = True
        elif t == "break":
            par.add_run().add_break()
        elif t == "slot":
            add_inline(par, ch.get("children", []), bold)


def add_rich_blocks(doc, content: dict | None, indent_cm=0.0, bold=False):
    """One Word paragraph per richtext block."""
    if not content:
        return
    for block in content.get("blocks", []):
        p = doc.add_paragraph()
        p.paragraph_format.space_after = Pt(2)
        if indent_cm:
            p.paragraph_format.left_indent = Cm(indent_cm)
        add_inline(p, block.get("children", []), bold)


def asset_path(asset: dict, media_root: Path) -> Path | None:
    sha = asset["sha256"]
    ext = {"image/png": "png", "image/jpeg": "jpg"}.get(asset["mime_type"])
    if not ext:
        return None
    p = media_root / sha[:2] / sha[2:4] / f"{sha}.{ext}"
    return p if p.exists() else None


def add_image(doc, asset: dict | None, media_root: Path):
    p = asset_path(asset, media_root) if asset else None
    if not p:
        doc.add_paragraph("［图片缺失］")
        return
    doc.add_picture(str(p), width=Cm(13))
    pic = doc.paragraphs[-1]
    pic.alignment = WD_ALIGN_PARAGRAPH.CENTER
    pic.paragraph_format.line_spacing = 1.0  # exact line height would clip the picture
    pic.paragraph_format.space_before = pic.paragraph_format.space_after = Pt(6)


def page_break(doc):
    doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)


class ExamData:
    """Neutral exam content. Records use the Canonical field names:

    exam{level,year,month}; sections[{key,subject,title,position}];
    layers[{id,section_key,display_label,instruction,position}];
    units[{id,layer_id,position,materials[{kind,role,content,asset_id}]}];
    questions[{id,unit_id,position,printed_number,prompt,media_asset_ids,
    options[{id,position,content,media_asset_ids}]}]; assets{id:{sha256,mime_type}};
    phases[{title,duration_seconds,position}]; keys{question_id:[option_id]};
    expl{owner_id:[{content}]}.
    """

    def __init__(self, exam, sections, layers, units, questions, assets, phases,
                 keys, expl, unverified_keys=0, skipped_units=0):
        self.exam = exam
        self.sections = sorted(sections, key=lambda x: x["position"])
        self.layers, self.units, self.questions = layers, units, questions
        self.assets, self.keys, self.expl = assets, keys, expl
        self.phases = sorted(phases, key=lambda x: x["position"])
        self.unverified_keys, self.skipped_units = unverified_keys, skipped_units
        self.layers_by_section = defaultdict(list)
        for ly in layers:
            self.layers_by_section[ly["section_key"]].append(ly)
        self.units_by_layer = defaultdict(list)
        for u in units:
            self.units_by_layer[u["layer_id"]].append(u)
        self.qs_by_unit = defaultdict(list)
        for q in questions:
            self.qs_by_unit[q["unit_id"]].append(q)

    def walk(self):
        """Yield (section, layer, [(unit, [questions])]) in print order."""
        for sec in self.sections:
            for ly in sorted(self.layers_by_section[sec["key"]], key=lambda x: x["position"]):
                units = sorted(self.units_by_layer[ly["id"]], key=lambda x: x["position"])
                yield sec, ly, [(u, sorted(self.qs_by_unit[u["id"]], key=lambda x: x["position"]))
                                for u in units]


def _jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(x) for x in path.read_text(encoding="utf-8").splitlines() if x.strip()]


def load_package_dir(d: Path) -> ExamData:
    """From a normalized Canonical v2.0 package directory (read-only)."""
    sections = _jsonl(d / "sections.jsonl")
    for s in sections:
        s["key"] = s["subject"]
    layers = _jsonl(d / "layers.jsonl")
    for ly in layers:
        ly["section_key"] = ly["section"]
    keys_raw = _jsonl(d / "answer_keys.private.jsonl")
    expl = defaultdict(list)
    for e in _jsonl(d / "explanations.jsonl"):
        expl[e["owner_id"]].append(e)
    return ExamData(
        json.loads((d / "exam.json").read_text(encoding="utf-8")), sections, layers,
        _jsonl(d / "units.jsonl"), _jsonl(d / "questions.jsonl"),
        {a["id"]: a for a in _jsonl(d / "assets.jsonl")}, _jsonl(d / "phases.jsonl"),
        {k["question_id"]: k["correct_option_ids"] for k in keys_raw}, expl,
        unverified_keys=sum(1 for k in keys_raw if k["review_status"] not in GOOD_REVIEW))


def load_release(conn, release_id: str) -> ExamData | None:
    """From a Release in PostgreSQL. Only complete units are included."""
    from sqlalchemy import text

    def rows(sql, **p):
        return conn.execute(text(sql), {"r": release_id, **p}).mappings().all()

    head = rows("SELECT e.level, e.year, e.month, e.id AS exam_id FROM exam_releases r"
                " JOIN exam_catalogs e ON e.id = r.exam_id WHERE r.id = :r")
    if not head:
        return None
    sections = [{"key": s["section_id"], "subject": s["subject"], "title": s["title"],
                 "position": s["position"]} for s in rows(
        "SELECT section_id, subject, title, position FROM release_sections WHERE release_id = :r")]
    layers = [{"id": ly["layer_id"], "section_key": ly["section_id"], "position": ly["position"],
               "display_label": ly["display_label"], "instruction": ly["instruction"]} for ly in rows(
        "SELECT layer_id, section_id, position, display_label, instruction"
        " FROM release_layers WHERE release_id = :r")]
    all_units = rows("SELECT unit_id, layer_id, position, conversion_status FROM release_units"
                     " WHERE release_id = :r")
    ok = {u["unit_id"] for u in all_units if u["conversion_status"] == "complete"}
    mats = defaultdict(list)
    for m in rows("SELECT unit_id, kind, role, content, asset_id FROM release_unit_materials"
                  " WHERE release_id = :r ORDER BY position"):
        mats[m["unit_id"]].append({"kind": m["kind"], "role": m["role"],
                                   "content": m["content"], "asset_id": m["asset_id"]})
    units = [{"id": u["unit_id"], "layer_id": u["layer_id"], "position": u["position"],
              "materials": mats[u["unit_id"]]} for u in all_units if u["unit_id"] in ok]
    opts = defaultdict(list)
    for o in rows("SELECT option_id, question_id, position, content FROM release_options"
                  " WHERE release_id = :r"):
        opts[o["question_id"]].append({"id": o["option_id"], "position": o["position"],
                                       "content": o["content"], "media_asset_ids": []})
    opt_by_id = {o["id"]: o for lst in opts.values() for o in lst}
    for om in rows("SELECT option_id, asset_id FROM release_option_media WHERE release_id = :r"):
        if om["option_id"] in opt_by_id:
            opt_by_id[om["option_id"]]["media_asset_ids"].append(om["asset_id"])
    qmedia = defaultdict(list)
    for qm in rows("SELECT question_id, asset_id FROM release_question_media WHERE release_id = :r"):
        qmedia[qm["question_id"]].append(qm["asset_id"])
    questions = [{"id": q["question_id"], "unit_id": q["unit_id"], "position": q["position"],
                  "printed_number": q["printed_number"], "prompt": q["prompt"],
                  "options": opts[q["question_id"]], "media_asset_ids": qmedia[q["question_id"]]}
                 for q in rows("SELECT question_id, unit_id, position, printed_number, prompt"
                               " FROM release_questions WHERE release_id = :r")
                 if q["unit_id"] in ok]
    qids = {q["id"] for q in questions}
    keys_rows = [k for k in rows("SELECT question_id, correct_option_id, review_status"
                                 " FROM release_answer_keys WHERE release_id = :r")
                 if k["question_id"] in qids]
    expl = defaultdict(list)
    for e in rows("SELECT question_id, unit_id, content FROM release_explanations"
                  " WHERE release_id = :r AND kind = 'analysis'"):
        owner = e["question_id"] or e["unit_id"]
        if owner in qids or owner in ok:
            expl[owner].append({"content": e["content"]})
    asset_ids = {m["asset_id"] for ms in mats.values() for m in ms if m["asset_id"]}
    asset_ids |= {a for q in questions for a in q["media_asset_ids"]}
    asset_ids |= {a for q in questions for o in q["options"] for a in o["media_asset_ids"]}
    assets = {}
    if asset_ids:
        for a in conn.execute(text("SELECT id, sha256, mime_type FROM media_assets WHERE id = ANY(:ids)"),
                              {"ids": list(asset_ids)}).mappings():
            assets[a["id"]] = dict(a)
    phases = [{"title": p["title"], "duration_seconds": p["duration_seconds"], "position": p["position"]}
              for p in rows("SELECT title, duration_seconds, position FROM release_exam_phases"
                            " WHERE release_id = :r")]
    return ExamData(dict(head[0]), sections, layers, units, questions, assets, phases,
                    {k["question_id"]: [k["correct_option_id"]] for k in keys_rows}, expl,
                    unverified_keys=sum(1 for k in keys_rows if k["review_status"] not in GOOD_REVIEW),
                    skipped_units=len(all_units) - len(ok))


def option_label(q, option_id):
    for o in q["options"]:
        if o["id"] == option_id:
            return str(o["position"])
    return "?"


def build_paper(pkg: "ExamData", out, media_root: Path):
    doc = new_doc()
    ex = pkg.exam
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_font(p.add_run(f"日本語能力試験 {ex['level']}　{ex['year']}年{ex['month']}月"), 20, True)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_font(p.add_run("問題冊子"), 14)
    for ph in pkg.phases:
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        mins = f"：{ph['duration_seconds'] // 60}分" if ph.get("duration_seconds") else ""
        set_font(p.add_run(f"{ph['title']}{mins}"), 11)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_font(p.add_run("受験番号：＿＿＿＿＿＿＿＿　　名前：＿＿＿＿＿＿＿＿"), 11)
    if pkg.skipped_units:
        n = doc.add_paragraph()
        set_font(n.add_run(f"（另有 {pkg.skipped_units} 个单元因待复核/未通过转换检查，未收录在本文档中。）"), 9)
    cur_section = None
    for sec, ly, units in pkg.walk():
        if sec["key"] != cur_section:
            if cur_section is not None:
                page_break(doc)
            cur_section = sec["key"]
            h = doc.add_heading(level=1)
            set_font(h.add_run(sec["title"]), 16, True)
            if sec["subject"] == "listening":
                n = doc.add_paragraph()
                set_font(n.add_run("（音声を聞いて答える。本文書には音声・スクリプトは含まれない。）"), 10)
        add_rich_blocks(doc, ly.get("instruction"), bold=True)
        for unit, qs in units:
            for m in unit["materials"]:
                if m["kind"] in ("audio", "transcript"):
                    continue
                if m["kind"] == "image":
                    add_image(doc, pkg.assets.get(m["asset_id"]), media_root)
                    continue
                if m["role"] in ("comparison_a", "comparison_b"):
                    lab = doc.add_paragraph()
                    set_font(lab.add_run("A" if m["role"] == "comparison_a" else "B"), 11, True)
                add_rich_blocks(doc, m["content"], indent_cm=0.5)
            for q in qs:
                p = doc.add_paragraph()
                p.paragraph_format.space_before = Pt(9)
                p.paragraph_format.space_after = Pt(0)
                p.paragraph_format.keep_with_next = True
                set_font(p.add_run(f"{q['printed_number']}．"), bold=True)
                add_rich(p, q.get("prompt"))
                for aid in q.get("media_asset_ids") or []:
                    add_image(doc, pkg.assets.get(aid), media_root)
                for o in sorted(q["options"], key=lambda x: x["position"]):
                    op = doc.add_paragraph()
                    op.paragraph_format.left_indent = Cm(1.0)
                    op.paragraph_format.space_before = Pt(0)
                    op.paragraph_format.space_after = Pt(0)
                    set_font(op.add_run(f"{o['position']}.　"))
                    add_rich(op, o["content"])
                    for aid in o.get("media_asset_ids") or []:
                        add_image(doc, pkg.assets.get(aid), media_root)
    doc.save(out)


def build_answers(pkg: "ExamData", out, media_root: Path):
    doc = new_doc()
    ex = pkg.exam
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_font(p.add_run(f"{ex['year']}年{ex['month']}月 {ex['level']}　答案与解析"), 18, True)
    note = doc.add_paragraph()
    if pkg.unverified_keys:
        set_font(note.add_run(
            f"注：本卷有 {pkg.unverified_keys} 题的答案尚未经过校验或人工核验，答案与解析仅供参考。"), 10)
    # answer table
    rows = []
    for sec, ly, units in pkg.walk():
        for unit, qs in units:
            for q in qs:
                k = pkg.keys.get(q["id"])
                ans = "、".join(option_label(q, i) for i in k) if k else "—"
                rows.append((sec["title"], q["printed_number"], ans))
    h = doc.add_heading(level=1)
    set_font(h.add_run("答案一览"), 14, True)
    cols = 5
    table = doc.add_table(rows=0, cols=cols * 2)
    table.style = "Table Grid"
    per_col = -(-len(rows) // cols)
    for r in range(per_col):
        cells = table.add_row().cells
        for c in range(cols):
            i = c * per_col + r
            if i < len(rows):
                for cell, txt in ((cells[c * 2], rows[i][1]), (cells[c * 2 + 1], rows[i][2])):
                    cell.text = ""
                    set_font(cell.paragraphs[0].add_run(txt), 10)
    page_break(doc)
    # explanations + transcripts
    for sec, ly, units in pkg.walk():
        h = doc.add_heading(level=2)
        set_font(h.add_run(f"{sec['title']}　{ly['display_label']}"), 13, True)
        for unit, qs in units:
            for m in unit["materials"]:
                if m["kind"] == "transcript":
                    t = doc.add_paragraph()
                    set_font(t.add_run("【听力原文】"), 10, True)
                    add_rich_blocks(doc, m["content"], indent_cm=0.5)
            for q in qs:
                k = pkg.keys.get(q["id"])
                ans = "、".join(option_label(q, i) for i in k) if k else "—"
                p = doc.add_paragraph()
                p.paragraph_format.space_before = Pt(6)
                set_font(p.add_run(f"{q['printed_number']}．答案：{ans}"), bold=True)
                for e in pkg.expl.get(q["id"], []) + pkg.expl.get(unit["id"], []):
                    add_rich_blocks(doc, e["content"], indent_cm=0.5)
    doc.save(out)


