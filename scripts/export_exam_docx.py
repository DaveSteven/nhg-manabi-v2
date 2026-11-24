#!/usr/bin/env python3
"""Export Canonical v2.0 exam packages to Word (.docx).

Reads a normalized package directory (read-only) and writes, per exam:
  <exam_id>-試題.docx        question paper, no answers
  <exam_id>-答案与解析.docx   answer key, explanations and listening transcripts

Usage:
  python3 scripts/export_exam_docx.py OUT_DIR PACKAGE_DIR [PACKAGE_DIR ...]

Answers in these packages are review_status=unverified; the answer document says so.
Requires python-docx.
"""
from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.oxml.ns import qn
from docx.shared import Cm, Pt

REPO = Path(__file__).resolve().parent.parent
MEDIA = REPO / "data" / "v2-media"
FONT = "Yu Mincho"
SUBJECT_ORDER = {"vocabulary": 1, "grammar": 2, "reading": 3, "listening": 4}


def load(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(x) for x in path.read_text(encoding="utf-8").splitlines() if x.strip()]


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
    sec.left_margin = sec.right_margin = Cm(2.2)
    sec.top_margin = sec.bottom_margin = Cm(2.2)
    for name in ("Normal", "Heading 1", "Heading 2", "Heading 3", "Title"):
        st = doc.styles[name]
        st.font.name = FONT
        st.element.get_or_add_rPr().get_or_add_rFonts().set(qn("w:eastAsia"), FONT)
        st.font.color.rgb = None
    doc.styles["Normal"].font.size = Pt(11)
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
        p.paragraph_format.space_after = Pt(3)
        if indent_cm:
            p.paragraph_format.left_indent = Cm(indent_cm)
        add_inline(p, block.get("children", []), bold)


def asset_path(asset: dict) -> Path | None:
    sha = asset["sha256"]
    ext = {"image/png": "png", "image/jpeg": "jpg"}.get(asset["mime_type"])
    if not ext:
        return None
    p = MEDIA / sha[:2] / sha[2:4] / f"{sha}.{ext}"
    return p if p.exists() else None


def add_image(doc, asset: dict | None):
    p = asset_path(asset) if asset else None
    if not p:
        doc.add_paragraph("［图片缺失］")
        return
    doc.add_picture(str(p), width=Cm(13))
    doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER


def page_break(doc):
    doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)


class Package:
    def __init__(self, d: Path):
        self.exam = json.loads((d / "exam.json").read_text(encoding="utf-8"))
        self.sections = sorted(load(d / "sections.jsonl"), key=lambda x: x["position"])
        self.layers = load(d / "layers.jsonl")
        self.units = load(d / "units.jsonl")
        self.questions = load(d / "questions.jsonl")
        self.assets = {a["id"]: a for a in load(d / "assets.jsonl")}
        self.phases = sorted(load(d / "phases.jsonl"), key=lambda x: x["position"])
        self.keys = {k["question_id"]: k for k in load(d / "answer_keys.private.jsonl")}
        self.expl = defaultdict(list)
        for e in load(d / "explanations.jsonl"):
            self.expl[e["owner_id"]].append(e)
        self.layers_by_section = defaultdict(list)
        for ly in self.layers:
            self.layers_by_section[ly["section"]].append(ly)
        self.units_by_layer = defaultdict(list)
        for u in self.units:
            self.units_by_layer[u["layer_id"]].append(u)
        self.qs_by_unit = defaultdict(list)
        for q in self.questions:
            self.qs_by_unit[q["unit_id"]].append(q)

    def walk(self):
        """Yield (section, layer, [(unit, [questions])]) in print order."""
        for sec in self.sections:
            for ly in sorted(self.layers_by_section[sec["subject"]], key=lambda x: x["position"]):
                units = sorted(self.units_by_layer[ly["id"]], key=lambda x: x["position"])
                yield sec, ly, [(u, sorted(self.qs_by_unit[u["id"]], key=lambda x: x["position"])) for u in units]


def option_label(q, option_id):
    for o in q["options"]:
        if o["id"] == option_id:
            return str(o["position"])
    return "?"


def build_paper(pkg: Package, out: Path):
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
        set_font(p.add_run(f"{ph['title']}：{ph['duration_seconds'] // 60}分"), 11)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_font(p.add_run("受験番号：＿＿＿＿＿＿＿＿　　名前：＿＿＿＿＿＿＿＿"), 11)
    cur_section = None
    for sec, ly, units in pkg.walk():
        if sec["subject"] != cur_section:
            if cur_section is not None:
                page_break(doc)
            cur_section = sec["subject"]
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
                    add_image(doc, pkg.assets.get(m["asset_id"]))
                    continue
                if m["role"] in ("comparison_a", "comparison_b"):
                    lab = doc.add_paragraph()
                    set_font(lab.add_run("A" if m["role"] == "comparison_a" else "B"), 11, True)
                add_rich_blocks(doc, m["content"], indent_cm=0.5)
            for q in qs:
                p = doc.add_paragraph()
                p.paragraph_format.space_before = Pt(6)
                p.paragraph_format.keep_with_next = True
                set_font(p.add_run(f"{q['printed_number']}．"), bold=True)
                add_rich(p, q.get("prompt"))
                for aid in q.get("media_asset_ids") or []:
                    add_image(doc, pkg.assets.get(aid))
                for o in sorted(q["options"], key=lambda x: x["position"]):
                    op = doc.add_paragraph()
                    op.paragraph_format.left_indent = Cm(1.0)
                    op.paragraph_format.space_after = Pt(1)
                    set_font(op.add_run(f"{o['position']}　"))
                    add_rich(op, o["content"])
                    for aid in o.get("media_asset_ids") or []:
                        add_image(doc, pkg.assets.get(aid))
    doc.save(out)


def build_answers(pkg: Package, out: Path):
    doc = new_doc()
    ex = pkg.exam
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_font(p.add_run(f"{ex['year']}年{ex['month']}月 {ex['level']}　答案与解析"), 18, True)
    note = doc.add_paragraph()
    set_font(
        note.add_run("注：答案与解析来自导入内容，当前状态为“未经人工核验”（review_status=unverified），仅供参考。"),
        10,
    )
    # answer table
    rows = []
    for sec, ly, units in pkg.walk():
        for unit, qs in units:
            for q in qs:
                k = pkg.keys.get(q["id"])
                ans = "、".join(option_label(q, i) for i in k["correct_option_ids"]) if k else "—"
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
                ans = "、".join(option_label(q, i) for i in k["correct_option_ids"]) if k else "—"
                p = doc.add_paragraph()
                p.paragraph_format.space_before = Pt(6)
                set_font(p.add_run(f"{q['printed_number']}．答案：{ans}"), bold=True)
                for e in pkg.expl.get(q["id"], []) + pkg.expl.get(unit["id"], []):
                    add_rich_blocks(doc, e["content"], indent_cm=0.5)
    doc.save(out)


def main(argv: list[str]) -> int:
    if len(argv) < 3:
        print(__doc__)
        return 2
    out_dir = Path(argv[1])
    out_dir.mkdir(parents=True, exist_ok=True)
    for d in argv[2:]:
        pkg = Package(Path(d))
        eid = pkg.exam["id"]
        build_paper(pkg, out_dir / f"{eid}-試題.docx")
        build_answers(pkg, out_dir / f"{eid}-答案与解析.docx")
        print(f"{eid}: {len(pkg.questions)} questions -> {out_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
