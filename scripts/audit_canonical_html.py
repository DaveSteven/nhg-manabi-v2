#!/usr/bin/env python3
"""Scan Canonical packages for residual upstream HTML artifacts (M1.5 §5).

Checks Question.prompt, Option.content, Material.content, Explanation.content
and Transcript cue text for: raw tags, unresolved MOJiTest placeholders,
HTML entities, class/style/data attribute remnants, and lost structural
markers. Structured traversal — no blanket regex deletion; this script only
reports.

Usage: python scripts/audit_canonical_html.py <Archive.zip | package-dir>
"""
import hashlib
import json
import re
import sys
import zipfile
from collections import Counter
from pathlib import Path

TAG_RE = re.compile(r"</?[a-zA-Z][a-zA-Z0-9]*[^>]*>")
ENTITY_RE = re.compile(r"&(?:[a-zA-Z][a-zA-Z0-9]{1,32}|#\d{1,7}|#[xX][0-9a-fA-F]{1,6});")
PLACEHOLDER_RE = re.compile(r"<MOJiTest_URL[^>]*>|MOJiTest_URL")
ATTR_RE = re.compile(r"(class|style|data-[a-z-]+)\s*=")


def iter_text_nodes(content, location, hits):
    """Yield every text string inside a RichText v1 structure."""
    if not isinstance(content, dict) or content.get("format") != "jlptgo-richtext-v1":
        if content is not None:
            hits["non_richtext"].append(location)
        return
    for bi, block in enumerate(content.get("blocks", [])):
        if block.get("type") not in ("paragraph", "heading", "list", "table", "image"):
            hits["unknown_block"].append(f"{location}.blocks[{bi}]:{block.get('type')}")
        for ch in block.get("children", []) or []:
            if ch.get("type") == "text":
                yield f"{location}.blocks[{bi}]", ch.get("text", "")
            elif ch.get("type") == "slot":
                yield f"{location}.blocks[{bi}]", ""  # slot anchors carry label children
                for c2 in ch.get("children", []) or []:
                    if c2.get("type") == "text":
                        yield f"{location}.blocks[{bi}].slot", c2.get("text", "")


def scan_text(text, location, hits):
    if not text:
        return
    if TAG_RE.search(text):
        hits["raw_tag"].append(f"{location}: {TAG_RE.search(text).group(0)[:60]}")
    if PLACEHOLDER_RE.search(text):
        hits["placeholder"].append(location)
    if ATTR_RE.search(text):
        hits["attr_remnant"].append(f"{location}: {ATTR_RE.search(text).group(0)[:60]}")
    for m in ENTITY_RE.finditer(text):
        if m.group(0) != "&amp;" and m.group(0) not in ("&lt;", "&gt;"):
            hits["entity"].append(f"{location}: {m.group(0)}")


def scan_records(records_by_file, package, hits):
    units = {u["id"]: u for u in records_by_file.get("units.jsonl", [])}
    questions = {q["id"]: q for q in records_by_file.get("questions.jsonl", [])}

    for qid, q in questions.items():
        for loc, text in iter_text_nodes(q.get("prompt"), f"{package}.question[{qid}].prompt", hits):
            scan_text(text, loc, hits)
        for o in q.get("options", []):
            for loc, text in iter_text_nodes(o.get("content"), f"{package}.question[{qid}].option[{o['id']}]", hits):
                scan_text(text, loc, hits)

    for uid, u in units.items():
        for i, m in enumerate(u.get("materials", [])):
            base = f"{package}.unit[{uid}].material[{m.get('id')}]"
            for loc, text in iter_text_nodes(m.get("content"), base, hits):
                scan_text(text, loc, hits)
            for c in m.get("cues") or []:
                for ch in c.get("children", []) or []:
                    if ch.get("type") == "text":
                        scan_text(ch.get("text", ""), f"{base}.cue[{c.get('index')}]", hits)
                raw = "".join(ch.get("text", "") for ch in c.get("children", []) if ch.get("type") == "text")
                if TAG_RE.search(raw) or PLACEHOLDER_RE.search(raw):
                    hits["cue_raw_tag"].append(f"{base}.cue[{c.get('index')}]")

    for e in records_by_file.get("explanations.jsonl", []):
        for loc, text in iter_text_nodes(e.get("content"), f"{package}.explanation[{e['id']}]", hits):
            scan_text(text, loc, hits)


def load(zf_or_dir):
    """Yield (package_id, records_by_file) for a zip or directory."""
    p = Path(zf_or_dir)
    files = ["exam.json", "sections.jsonl", "layers.jsonl", "question_types.jsonl",
             "units.jsonl", "questions.jsonl", "answer_keys.private.jsonl",
             "explanations.jsonl", "assets.jsonl"]
    if p.is_dir():
        for sub in sorted(p.glob("JLPTGO-*")):
            recs = {}
            for name in files:
                raw = (sub / name).read_text(encoding="utf-8")
                if name.endswith(".jsonl"):
                    recs[name] = [json.loads(l) for l in raw.splitlines() if l.strip()]
                else:
                    recs[name] = [json.loads(raw)]
            yield sub.name, recs
    else:
        with zipfile.ZipFile(p) as z:
            prefixes = sorted({q.rsplit("/", 1)[0] + "/" for q in z.namelist()
                               if q.endswith("manifest.json")})
            for prefix in prefixes:
                recs = {}
                for name in files:
                    raw = z.read(prefix + name).decode("utf-8")
                    if name.endswith(".jsonl"):
                        recs[name] = [json.loads(l) for l in raw.splitlines() if l.strip()]
                    else:
                        recs[name] = [json.loads(raw)]
                yield prefix.rstrip("/"), recs


def main() -> int:
    target = sys.argv[1]
    hits = {k: [] for k in ("raw_tag", "placeholder", "attr_remnant", "entity",
                            "cue_raw_tag", "non_richtext", "unknown_block")}
    stats = {"packages": 0, "text_nodes": 0, "cues": 0}
    for package, recs in load(target):
        stats["packages"] += 1
        scan_records(recs, package, hits)
        for u in recs.get("units.jsonl", []):
            for m in u.get("materials", []):
                stats["cues"] += len(m.get("cues") or [])

    report = {
        "target": str(target),
        "packages": stats["packages"],
        "cue_count": stats["cues"],
        "findings": {k: v[:50] for k, v in hits.items()},
        "finding_counts": {k: len(v) for k, v in hits.items()},
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    digest = hashlib.sha256(json.dumps(report, sort_keys=True).encode()).hexdigest()[:16]
    print(f"report_digest: {digest}", file=sys.stderr)
    return 0 if not any(hits.values()) else 1


if __name__ == "__main__":
    sys.exit(main())
