#!/usr/bin/env python3
"""Convert raw MOJiTest exam snapshots into Canonical Package v2.0.

Implements JLPT_GO_Canonical_Schema_v2.0.md:
- package layout per §3 (manifest / exam / sections / layers / question_types /
  units / questions / answer_keys.private / explanations / assets / provenance / reports)
- RichText v1 (§5) via a restricted HTML whitelist parser
- Unit/Question/Option/AnswerKey/Explanation/MediaAsset entities per §4
- conversion rules per §6, structural validation per §7.1, N2 baseline per §7.3

Deterministic: same input + same converter version -> identical output (IDs and
file bytes), satisfying the duplicate-import acceptance rule (§12).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
from collections import Counter
from datetime import datetime, timezone
from html import unescape
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

SCHEMA_VERSION = "2.0.0"
CONVERTER_VERSION = "canonical_v2.0-converter+0.1.1"
SOURCE_SYSTEM = "mojitest"

SUBJECT_BY_RANGE = [
    (11, 16, "vocabulary"),
    (21, 23, "grammar"),
    (31, 36, "reading"),
    (41, 46, "listening"),
]
SECTION_TITLES = {
    "vocabulary": "文字・語彙",
    "grammar": "文法",
    "reading": "読解",
    "listening": "聴解",
}

# Proposed semantic ids for source integer question types (§4.4).
# Some reading ids are provisional — see PROVISIONAL_QTYPES and import_report.
QUESTION_TYPE_IDS = {
    11: "vocabulary_kanji_reading",
    12: "vocabulary_orthography",
    13: "vocabulary_context",
    14: "vocabulary_paraphrase",
    15: "vocabulary_usage",
    16: "vocabulary_word_formation",
    21: "grammar_form",
    22: "grammar_sentence_composition",
    23: "grammar_cloze",
    31: "reading_short",
    32: "reading_short_set",
    33: "reading_medium",
    34: "reading_integrated",
    35: "reading_long",
    36: "reading_information_search",
    41: "listening_topic_comprehension",
    42: "listening_point_comprehension",
    43: "listening_summary_comprehension",
    44: "listening_speech_expression",
    45: "listening_quick_response",
    46: "listening_long_comprehension",
}
PROVISIONAL_QTYPES = {32, 33, 34, 35, 36}
QUESTION_TYPE_LABELS = {
    11: ("漢字読み", "汉字读音"),
    12: ("表記", "汉字书写"),
    13: ("文脈規定", "文脉规定"),
    14: ("言い換え類義", "近义替换"),
    15: ("用法", "用法"),
    16: ("造語", "造语"),
    21: ("文の文法１（文法形式）", "语法形式判断"),
    22: ("文の文法２（文の組み立て）", "句子重组"),
    23: ("文の文法３（文章の文法）", "文章语法（完形填空）"),
    31: ("内容理解（短編）", "内容理解（短篇）"),
    32: ("内容理解（短編・複数）", "内容理解（短篇·多篇）"),
    33: ("内容理解（中編）", "内容理解（中篇）"),
    34: ("統合理解", "整合理解（A/B 对比）"),
    35: ("主張理解（長編）", "主张理解（长篇）"),
    36: ("情報検索", "信息检索"),
    41: ("課題理解", "课题理解"),
    42: ("ポイント理解", "要点理解"),
    43: ("概要理解", "概要理解"),
    44: ("発話表現", "发话表现"),
    45: ("即時応答", "即时应答"),
    46: ("統合理解", "综合理解"),
}


def subject_of(qtype: int) -> str:
    for lo, hi, subject in SUBJECT_BY_RANGE:
        if lo <= qtype <= hi:
            return subject
    raise ValueError(f"unknown questionType: {qtype}")


def qtype_id(qtype: int) -> str:
    return QUESTION_TYPE_IDS[qtype]


# ---------------------------------------------------------------------------
# RichText v1 (§5)
# ---------------------------------------------------------------------------

ALLOWED_MARKS = {"underline", "bold", "italic"}
PLACEHOLDER_TAG = "mojitest_url"


class RichtextWarning(Exception):
    pass


class RestrictedHTMLParser(HTMLParser):
    """Convert a restricted subset of upstream HTML into RichText v1 nodes.

    Whitelist: p, div (paragraph containers), u/b/strong (underline/bold),
    i/em (italic), br (break). Any other tag is recorded as an unknown-tag
    warning and its text passes through (nothing silently dropped, §5 无损原则).
    `mojitest_url` placeholder tags are dropped from the rendered text and
    reported — never emitted as a URL (§5.3).
    """

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.blocks: list[dict[str, Any]] = []
        self.children: list[dict[str, Any]] = []
        self.marks: list[str] = []
        self.open_unknown: list[str] = []
        self.placeholders = 0
        self.paragraph_times: list[tuple[str, str] | None] = []
        # per-paragraph (start, end) time attrs, aligned with self.blocks
        # Attributes are audited, never silently accepted: handled ones
        # (data-starttime/data-endtime) excluded, everything else counted
        # for the import report (§5 无损原则 — unknown structure is reported).
        self.unknown_attrs: Counter[tuple[str, str]] = Counter()
        self.style_semantics: Counter[str] = Counter()
        self.block_times: list[tuple[str, str] | None] = []
        self.unknown_tags: Counter[str] = Counter()
        self._current_para_times: tuple[str, str] | None = None

    # -- helpers ----------------------------------------------------------
    def _flush_paragraph(self) -> None:
        if self.children:
            block: dict[str, Any] = {"type": "paragraph", "children": self.children}
            if self._current_para_times and any(t for t in self._current_para_times):
                block["_time"] = self._current_para_times
            self.blocks.append(block)
            self.block_times.append(self._current_para_times)
            self.children = []
        self._current_para_times = None

    def _add_text(self, raw: str) -> None:
        if not raw:
            return
        text = unescape(raw)
        if not text:
            return
        marks = [m for m in self.marks if m in ALLOWED_MARKS]
        node: dict[str, Any] = {"type": "text", "text": text}
        if marks:
            node["marks"] = marks
        self.children.append(node)

    # -- parser hooks ------------------------------------------------------
    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        attrd = {k.lower(): (v or "") for k, v in attrs}
        if tag != PLACEHOLDER_TAG:
            handled = ({"p", "div"} & {tag}) and {"data-starttime", "data-endtime"} or set()
            for name, value in attrd.items():
                if name in handled:
                    continue
                self.unknown_attrs[(tag, name)] += 1
                if name == "style" and value:
                    # Style may carry semantics (e.g. double underline);
                    # record the declaration instead of silently dropping it.
                    self.style_semantics[value.strip().rstrip(";")] += 1
        if tag == PLACEHOLDER_TAG:
            self.placeholders += 1
            return
        if tag in ("p", "div"):
            self._flush_paragraph()
            t = attrd.get("data-starttime") or ""
            e = attrd.get("data-endtime") or ""
            self._current_para_times = (t, e) if (t or e) else None
            return
        if tag == "br":
            self.children.append({"type": "break"})
            return
        if tag in ("u",):
            self.marks.append("underline")
            return
        if tag in ("b", "strong"):
            self.marks.append("bold")
            return
        if tag in ("i", "em"):
            self.marks.append("italic")
            return
        self.unknown_tags[tag] += 1
        self.open_unknown.append(tag)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if tag == "br":
            self.children.append({"type": "break"})
        elif tag == PLACEHOLDER_TAG:
            self.placeholders += 1
        else:
            self.unknown_tags[tag] += 1

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag == PLACEHOLDER_TAG:
            return
        if tag in ("p", "div"):
            self._flush_paragraph()
            return
        if tag == "u" and "underline" in self.marks:
            self.marks.remove("underline")
            return
        if tag in ("b", "strong") and "bold" in self.marks:
            self.marks.remove("bold")
            return
        if tag in ("i", "em") and "italic" in self.marks:
            self.marks.remove("italic")
            return
        if tag in self.open_unknown:
            self.open_unknown.remove(tag)

    def handle_data(self, data: str) -> None:
        self._add_text(data)

    def close(self) -> None:  # noqa: D102
        super().close()
        self._flush_paragraph()


def parse_richtext(html: str | None) -> tuple[dict[str, Any] | None, dict[str, Any]]:
    """Return (richtext_or_none, meta). meta carries conversion diagnostics.

    meta keys: placeholders (int), unknown_tags (Counter), paragraph_times
    (list aligned with blocks for subtitle parsing), block_count.
    """
    parser = RestrictedHTMLParser()
    parser.feed(html or "")
    parser.close()
    meta = {
        "placeholders": parser.placeholders,
        "unknown_tags": dict(parser.unknown_tags),
        "unknown_attrs": {f"{t}@{a}": n for (t, a), n in parser.unknown_attrs.items()},
        "style_semantics": dict(parser.style_semantics),
        "paragraph_times": parser.block_times,
        "block_count": len(parser.blocks),
    }
    if not parser.blocks:
        return None, meta
    rt = {"format": "jlptgo-richtext-v1", "blocks": parser.blocks}
    return rt, meta


def strip_times(blocks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for b in blocks:
        b = dict(b)
        b.pop("_time", None)
        out.append(b)
    return out


def finalize_richtext(rt: dict[str, Any] | None) -> dict[str, Any] | None:
    if rt is None:
        return None
    return {"format": rt["format"], "blocks": strip_times(rt["blocks"])}


def has_visible_text(rt: dict[str, Any] | None) -> bool:
    if not rt:
        return False
    for block in rt["blocks"]:
        for child in block.get("children", []):
            if child.get("type") == "text" and child.get("text", "").strip():
                return True
            if child.get("type") == "slot":
                return True
    return False


def parse_time_ms(value: str) -> int | None:
    m = re.fullmatch(r"(\d+):(\d{1,2}):(\d{1,2})[.,](\d{1,3})", value.strip())
    if not m:
        return None
    h, mi, s, ms = (int(x) for x in m.groups())
    return ((h * 60 + mi) * 60 + s) * 1000 + ms


def parse_subtitles(html: str | None) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Parse caption paragraphs with data-starttime/data-endtime into cues (§5.4)."""
    rt, meta = parse_richtext(html)
    cues: list[dict[str, Any]] = []
    bad_times = 0
    times = meta.get("paragraph_times") or []
    for i, block in enumerate(rt["blocks"] if rt else []):
        t = times[i] if i < len(times) else None
        start_ms = end_ms = None
        if t:
            start_ms = parse_time_ms(t[0]) if t[0] else None
            end_ms = parse_time_ms(t[1]) if t[1] else None
        if start_ms is None or end_ms is None:
            bad_times += 1
        cue: dict[str, Any] = {"index": len(cues) + 1}
        if start_ms is not None:
            cue["start_ms"] = start_ms
        if end_ms is not None:
            cue["end_ms"] = end_ms
        cue["children"] = [
            c for c in block.get("children", []) if c.get("type") != "break"
        ]
        cues.append(cue)
    meta["cues_missing_time"] = bad_times
    return cues, meta


# ---------------------------------------------------------------------------
# Cloze slot detection
# ---------------------------------------------------------------------------

CLOZE_ANCHOR = re.compile(r"[（(]\s*([0-9０-９]{1,3})\s*[)）]")


def wide_to_ascii_digits(s: str) -> str:
    return s.translate(str.maketrans("０１２３４５６７８９", "0123456789"))


def bind_cloze_slots(
    passage_rt: dict[str, Any], printed_numbers: list[str], unit_id: str
) -> tuple[dict[str, Any], list[str], list[str]]:
    """Replace （ N ） anchors with slot nodes; return (rt, bound, unbound).

    printed_numbers are the unit's questions' printed numbers (ASCII digits).
    Unmatched anchors/questions stay as visible text and are reported (§4.6:
    不得猜位置).
    """
    wanted = set(printed_numbers)
    bound: list[str] = []
    used_numbers: set[str] = set()
    out_blocks = []
    for block in passage_rt["blocks"]:
        children = []
        for child in block.get("children", []):
            if child.get("type") != "text":
                children.append(child)
                continue
            text = child.get("text", "")
            pos = 0
            for m in CLOZE_ANCHOR.finditer(text):
                number = wide_to_ascii_digits(m.group(1))
                if number not in wanted or number in used_numbers:
                    continue
                children.append({"type": "text", "text": text[pos : m.start()]})
                children.append({
                    "type": "slot",
                    "slot_id": f"{unit_id}-s{number}",
                    "children": [{"type": "text", "text": m.group(0)}],
                })
                bound.append(number)
                used_numbers.add(number)
                pos = m.end()
            children.append({"type": "text", "text": text[pos:]})
        out_blocks.append({**block, "children": children})
    unbound = sorted(wanted - used_numbers)
    rt = {"format": "jlptgo-richtext-v1", "blocks": out_blocks}
    return rt, bound, unbound


# ---------------------------------------------------------------------------
# Comparison (A/B) document splitting
# ---------------------------------------------------------------------------

AB_HEADER = re.compile(r"^\s*[ＡAＢB]\s*[.．、]?\s*(　|\s|$)")


def split_comparison(rt: dict[str, Any]) -> list[list[dict[str, Any]]]:
    """Split passage blocks into documents at A/B header paragraphs.

    Returns one or two document block-lists; heuristic, units flagged for review.
    """
    docs: list[list[dict[str, Any]]] = []
    current: list[dict[str, Any]] = []
    for raw_block in rt["blocks"]:
        block = dict(raw_block)
        text = "".join(
            c.get("text", "") for c in block.get("children", []) if c.get("type") == "text"
        )
        head = AB_HEADER.match(text)
        stripped = text.strip("　.．、 ")
        if head and stripped[:1] in ("A", "Ａ", "B", "Ｂ"):
            if current:
                docs.append(current)
            label = stripped[0]
            rest = stripped[1:].lstrip("　.．、 ")
            rest_blocks = []
            if rest:
                rest_blocks.append({
                    "type": "paragraph",
                    "children": [{"type": "text", "text": rest}],
                })
            current = [
                {
                    "type": "paragraph",
                    "children": [{"type": "text", "text": label, "marks": ["bold"]}],
                }
            ] + rest_blocks
            continue
        current.append(block)
    if current:
        docs.append(current)
    return docs


# ---------------------------------------------------------------------------
# Small utilities
# ---------------------------------------------------------------------------


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def write_jsonl(path: Path, records: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        for rec in records:
            fh.write(json.dumps(rec, ensure_ascii=False) + "\n")


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def sniff_mime(path: Path) -> str | None:
    with path.open("rb") as fh:
        head = fh.read(16)
    if head.startswith(b"ID3") or (len(head) >= 2 and head[0] == 0xFF and (head[1] & 0xE0) == 0xE0):
        return "audio/mpeg"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if head.startswith(b"GIF8"):
        return "image/gif"
    if head[4:8] == b"ftyp":
        return "audio/mp4"
    if head.startswith(b"OggS"):
        return "audio/ogg"
    if head.startswith(b"RIFF") and head[8:12] == b"WAVE":
        return "audio/wav"
    return None


def audio_duration_ms(path: Path) -> int | None:
    try:
        out = subprocess.run(
            ["afinfo", str(path)], capture_output=True, text=True, timeout=60
        )
        m = re.search(r"estimated duration:\s*([0-9.]+)\s*sec", out.stdout)
        if m:
            return int(float(m.group(1)) * 1000)
    except Exception:
        pass
    return None


# ---------------------------------------------------------------------------
# Converter
# ---------------------------------------------------------------------------


class Converter:
    def __init__(self, exam_dir: Path, out_dir: Path) -> None:
        self.exam_dir = exam_dir
        self.out_dir = out_dir
        self.warnings: list[dict[str, Any]] = []
        self.attr_audit: Counter[str] = Counter()
        self.unresolved: list[dict[str, Any]] = []
        self.level = ""
        self.year = 0
        self.month = 0
        self.exam_id = ""
        self.package_id = ""
        self.assets: dict[str, dict[str, Any]] = {}  # source resource id -> asset record
        self.unit_slot_map: dict[str, list[str]] = {}

    def warn(self, code: str, message: str, **extra: Any) -> None:
        entry = {"code": code, "message": message}
        entry.update(extra)
        self.warnings.append(entry)

    def note_meta(self, meta: dict[str, Any], context: str) -> None:
        """Audit HTML attributes: aggregate for the report, warn on style
        semantics. Unknown attributes are recorded, never silently dropped."""
        for key, n in (meta.get("unknown_attrs") or {}).items():
            self.attr_audit[key] += n
        for decl in (meta.get("style_semantics") or {}):
            self.warn(
                "style_semantics",
                f"来源 style 属性含语义声明（已记录，未静默丢弃）: {decl!r}: {context}",
            )

    # -- metadata ----------------------------------------------------------
    def load_sources(self) -> tuple[dict[str, Any], list[dict[str, Any]]]:
        metadata = json.loads((self.exam_dir / "metadata.json").read_text(encoding="utf-8"))
        question_groups = json.loads(
            (self.exam_dir / "question_groups.json").read_text(encoding="utf-8")
        )
        # redundant-tree consistency check (§6)
        exam_json = json.loads((self.exam_dir / "exam.json").read_text(encoding="utf-8"))
        eg = exam_json.get("questionGroups") or []
        if [g.get("objectId") for g in eg] != [g.get("objectId") for g in question_groups]:
            self.warn(
                "redundant_tree_mismatch",
                "exam.json.questionGroups 与 question_groups.json 顶层节点不一致，以 question_groups.json 为权威",
            )
        groups_dir = self.exam_dir / "groups"
        if groups_dir.exists():
            n_files = len(list(groups_dir.glob("*.json")))
            if n_files != len(question_groups):
                self.warn(
                    "redundant_tree_mismatch",
                    f"groups/*.json 数量 ({n_files}) 与 question_groups.json 层数 ({len(question_groups)}) 不一致",
                )
        self.level = metadata["tag"].upper()
        self.year = int(metadata["year"])
        self.month = int(metadata["month"])
        session = f"{self.year}-{self.month:02d}"
        self.exam_id = f"JLPTGO-{self.level}-{self.year}-{self.month:02d}"
        self.package_id = f"{self.exam_id}-r1"
        return metadata, question_groups

    def source_archive_digest(self) -> str:
        """Digest over the extracted raw batch (original ZIP not retained)."""
        h = hashlib.sha256()
        files = sorted(p for p in self.exam_dir.rglob("*") if p.is_file())
        for p in files:
            rel = p.relative_to(self.exam_dir).as_posix()
            h.update(rel.encode("utf-8"))
            h.update(sha256_file(p).encode("ascii"))
        return h.hexdigest()

    # -- assets ------------------------------------------------------------
    def build_assets(self) -> list[dict[str, Any]]:
        manifest = json.loads((self.exam_dir / "resources.json").read_text(encoding="utf-8"))
        structure = json.loads((self.exam_dir / "structure.json").read_text(encoding="utf-8"))
        result = structure.get("result", structure)
        result = result.get("result", result) if isinstance(result, dict) else result
        full_audio_media_id = (result or {}).get("mediaId") or ""

        records = []
        for seq, res in enumerate(manifest, 1):
            source_id = res["id"]
            raw = (self.exam_dir / res["path"]).read_bytes()
            digest = sha256_bytes(raw)
            actual_size = len(raw)
            declared_size = int(res["size"])
            mime_declared = res.get("contentType") or ""
            mime_sniffed = sniff_mime((self.exam_dir / res["path"]))
            if actual_size != declared_size:
                self.warn(
                    "asset_size_mismatch",
                    f"资源实际 {actual_size}B 与清单声明 {declared_size}B 不一致: {source_id}",
                )
            if mime_sniffed and mime_declared and mime_sniffed != mime_declared:
                self.warn(
                    "asset_mime_mismatch",
                    f"MIME 声明 {mime_declared} 与文件签名 {mime_sniffed} 不一致: {source_id}",
                )
            suffix = Path(source_id).suffix.lower()
            if not re.fullmatch(r"\.[a-z0-9]{1,5}", suffix):
                suffix = {
                    "audio/mpeg": ".mp3", "image/png": ".png", "image/jpeg": ".jpg",
                }.get(mime_sniffed or mime_declared, ".bin")
            asset_id = f"{self.exam_id}-as{seq:03d}"
            availability = "verified" if actual_size == declared_size else "corrupt"
            rec: dict[str, Any] = {
                "record_type": "media_asset",
                "schema_version": SCHEMA_VERSION,
                "id": asset_id,
                "storage_key": f"assets/{self.exam_id}/{digest[:16]}{suffix}",
                "mime_type": mime_sniffed or mime_declared or "application/octet-stream",
                "sha256": digest,
                "size_bytes": actual_size,
                "duration_ms": None,
                "availability": availability,
            }
            if rec["mime_type"].startswith("audio/"):
                rec["duration_ms"] = audio_duration_ms(self.exam_dir / res["path"])
            rec["_source"] = {
                "source_system": SOURCE_SYSTEM,
                "source_object_id": source_id,
                "source_node_path": f"resources[{seq - 1}]",
                "canonical_type": "media_asset",
                "canonical_id": asset_id,
                "raw_node_hash": sha256_bytes(canonical_json(res).encode("utf-8")),
                "declared_size": declared_size,
                "declared_mime": mime_declared,
            }
            records.append(rec)
            self.assets[source_id] = rec
            if source_id == full_audio_media_id:
                self.full_audio_asset_id = asset_id
        self.full_audio_asset_id = getattr(self, "full_audio_asset_id", None)
        if full_audio_media_id and full_audio_media_id not in self.assets:
            self.warn(
                "full_audio_missing",
                f"structure.json 引用的整卷音频 {full_audio_media_id} 不在 resources.json 清单中",
            )
        return records

    # -- conversion --------------------------------------------------------
    def convert(self) -> dict[str, Any]:
        metadata, question_groups = self.load_sources()
        asset_records = self.build_assets()
        archive_digest = self.source_archive_digest()

        now = datetime.now(timezone.utc).isoformat()

        # ---- question_type dictionary subset (§4.4)
        used_qtypes: set[int] = set()

        def collect_qtypes(nodes: list[dict[str, Any]]) -> None:
            for n in nodes:
                qt = n.get("questionType")
                if isinstance(qt, int):
                    used_qtypes.add(qt)
                collect_qtypes(n.get("items") or [])

        collect_qtypes(question_groups)
        question_types = []
        for qt in sorted(used_qtypes):
            label_ja, label_zh = QUESTION_TYPE_LABELS.get(
                qt, (f"未確認の型{qt}", f"未确认题型{qt}")
            )
            question_types.append({
                "record_type": "question_type",
                "schema_version": SCHEMA_VERSION,
                "id": qtype_id(qt),
                "source_type_code": qt,
                "subject": subject_of(qt),
                "label_zh": label_zh,
                "label_ja": label_ja,
                "answer_mode": "single_choice",
                "default_unit_kind": (
                    "cloze" if qt == 23
                    else "audio" if qt in (41, 42, 43, 44, 45, 46)
                    else "passage" if qt in (31, 32, 33, 34, 35, 36)
                    else "single"
                ),
                "_provisional": qt in PROVISIONAL_QTYPES,
            })

        # ---- sections & layers (§4.3, §4.5)
        layers: list[dict[str, Any]] = []
        units: list[dict[str, Any]] = []
        questions: list[dict[str, Any]] = []
        answer_keys: list[dict[str, Any]] = []
        explanations: list[dict[str, Any]] = []
        provenance: list[dict[str, Any]] = []

        layer_subjects: list[tuple[int, str]] = []
        layer_position_by_subject: Counter[str] = Counter()
        section_positions: dict[str, int] = {}
        layer_global_idx = 0

        for li, group in enumerate(question_groups):
            qt = int(group["questionType"])
            subject = subject_of(qt)
            if subject not in section_positions:
                section_positions[subject] = len(section_positions) + 1
                layer_subjects.append((len(section_positions), subject))
            layer_position_by_subject[subject] += 1
            layer_pos = layer_position_by_subject[subject]
            layer_global_idx += 1
            # ID 后缀用全卷全局序号保证唯一；position 保持科目内唯一（§4.5）
            layer_id = f"{self.exam_id}-ly-{layer_global_idx:02d}"

            title_html = group.get("title") or ""
            inst_rt, inst_meta = parse_richtext(title_html)
            self.note_meta(inst_meta, f"layer_instruction:{layer_id}")
            if inst_meta["placeholders"]:
                self.warn(
                    "placeholder_in_instruction",
                    f"大题说明含 <MOJiTest_URL> 占位符，已记录未输出: layer={layer_id}",
                )
            if inst_meta["unknown_tags"]:
                self.warn(
                    "unknown_tag",
                    f"大题说明含未白名单标签 {inst_meta['unknown_tags']}: layer={layer_id}",
                )
            m_label = re.search(r"問題\s*([0-9０-９１-９１-９]+|[一二三四五六七八九十]+)", title_html)
            display_label = f"問題{m_label.group(1)}" if m_label else f"問題{layer_pos}"
            layers.append({
                "record_type": "layer",
                "schema_version": SCHEMA_VERSION,
                "id": layer_id,
                "exam_id": self.exam_id,
                "section": subject,
                "question_type_id": qtype_id(qt),
                "position": layer_pos,
                "display_label": display_label,
                "instruction": finalize_richtext(inst_rt),
            })
            provenance.append(self._prov("layer", layer_id, f"layers[{li}]", group))

            # ---- units within layer (§4.6)
            unit_pos = 0
            for ui, item in enumerate(group.get("items") or []):
                dtype = item.get("dataType")
                if dtype == 22:
                    unit_pos += 1
                    self._convert_single_unit(
                        layer_id, layer_pos, unit_pos, qt, item, f"layers[{li}].items[{ui}]",
                        units, questions, answer_keys, explanations, provenance,
                    )
                elif dtype == 21:
                    unit_pos += 1
                    self._convert_group_unit(
                        layer_id, layer_pos, unit_pos, qt, item, f"layers[{li}].items[{ui}]",
                        units, questions, answer_keys, explanations, provenance,
                    )
                else:
                    self.warn(
                        "unexpected_node",
                        f"大题下未知 dataType={dtype} 节点已跳过: layer={layer_id} items[{ui}]",
                    )

        # ---- exam (§4.2)
        exam = {
            "record_type": "exam",
            "schema_version": SCHEMA_VERSION,
            "id": self.exam_id,
            "level": self.level,
            "year": self.year,
            "month": self.month,
            "title": f"{self.year}年{self.month}月 {self.level}",
            "kind": "past_exam",
            "full_audio_asset_id": getattr(self, "full_audio_asset_id", None),
            "status": "draft",
            "_source": {
                "source_object_id": metadata.get("objectId") or metadata.get("id"),
                "source_session": metadata.get("session"),
            },
        }

        sections = []
        for pos, subject in layer_subjects:
            sections.append({
                "record_type": "section",
                "schema_version": SCHEMA_VERSION,
                "id": f"{self.exam_id}-sec-{subject}",
                "exam_id": self.exam_id,
                "subject": subject,
                "position": pos,
                "title": SECTION_TITLES[subject],
            })

        counts = {
            "sections": len(sections),
            "layers": len(layers),
            "units": len(units),
            "questions": len(questions),
            "assets": len(asset_records),
            "explanations": len(explanations),
            "source_groups_21": sum(1 for u in units if u["_source_group"]),
            "single_units": sum(1 for u in units if u["kind"] == "single"),
        }

        # ---- write package (§3)
        if self.out_dir.exists():
            shutil.rmtree(self.out_dir)
        (self.out_dir / "provenance").mkdir(parents=True)
        (self.out_dir / "reports").mkdir(parents=True)

        exam_rec = {k: v for k, v in exam.items() if k != "_source"}
        write_json(self.out_dir / "exam.json", exam_rec)
        write_jsonl(self.out_dir / "sections.jsonl", sections)
        write_jsonl(self.out_dir / "question_types.jsonl", question_types)
        write_jsonl(self.out_dir / "layers.jsonl", layers)
        write_jsonl(self.out_dir / "units.jsonl", [self._public_unit(u) for u in units])
        write_jsonl(self.out_dir / "questions.jsonl", [self._public_question(q) for q in questions])
        write_jsonl(self.out_dir / "answer_keys.private.jsonl", answer_keys)
        write_jsonl(self.out_dir / "explanations.jsonl", explanations)
        write_jsonl(
            self.out_dir / "assets.jsonl",
            [{k: v for k, v in a.items() if k != "_source"} for a in asset_records],
        )
        write_jsonl(self.out_dir / "provenance" / "source_refs.private.jsonl", provenance)

        segment_counts = Counter()
        for q in questions:
            segment_counts[q["question_type_id"]] += 1

        validation = self.validate(
            counts, sections, layers, units, questions, answer_keys, asset_records, explanations
        )

        import_report = {
            "source_attr_audit": dict(self.attr_audit),
            "package_id": self.package_id,
            "generated_at": now,
            "converter_version": CONVERTER_VERSION,
            "source_archive_sha256": archive_digest,
            "source_archive_note": (
                "原始 ZIP 未随抓取快照保留；此哈希为对解包后整目录（相对路径+文件 SHA-256）"
                "的确定性批摘要，算法 version=1"
            ),
            "counts": counts,
            "questions_by_type": dict(sorted(segment_counts.items())),
            "redundant_trees": "question_groups.json 为题树权威；exam.json/groups/*.json 仅对照",
            "provisional_question_types": [
                q["id"] for q in question_types if q["_provisional"]
            ],
            "slot_binding": {
                "bound": len([b for u in units for b in u.get("_slot_bound", [])]),
                "unbound": [b for u in units for b in u.get("_slot_unbound", [])],
            },
            "comparison_units": [
                u["id"] for u in units if u.get("_comparison_detected")
            ],
            "media_notes": {
                "placeholder_leaves": len(
                    [w for w in self.warnings if w["code"] == "leaf_prompt_placeholder"]
                ),
                "full_audio_asset_id": getattr(self, "full_audio_asset_id", None),
            },
            "warnings": self.warnings,
            "unresolved_items": self.unresolved,
            "validation": validation,
        }
        write_json(self.out_dir / "reports" / "import_report.json", import_report)

        # ---- manifest (§4.1)
        files = []
        for rel in [
            "exam.json",
            "sections.jsonl",
            "question_types.jsonl",
            "layers.jsonl",
            "units.jsonl",
            "questions.jsonl",
            "answer_keys.private.jsonl",
            "explanations.jsonl",
            "assets.jsonl",
            "provenance/source_refs.private.jsonl",
            "reports/import_report.json",
        ]:
            p = self.out_dir / rel
            files.append({
                "path": rel,
                "sha256": sha256_file(p),
                "bytes": p.stat().st_size,
            })
        manifest = {
            "record_type": "manifest",
            "schema_version": SCHEMA_VERSION,
            "package_id": self.package_id,
            "exam_id": self.exam_id,
            "release_id": None,
            "content_hash": None,
            "state": "draft",
            "counts": counts,
            "files": files,
            "source_archive_sha256": archive_digest,
            "conversion_version": CONVERTER_VERSION,
            "generated_at": now,
        }
        write_json(self.out_dir / "manifest.json", manifest)

        return {
            "package_id": self.package_id,
            "counts": counts,
            "warnings": len(self.warnings),
            "validation": import_report["validation"],
        }

    # -- provenance helper ---------------------------------------------------
    def _prov(
        self, canonical_type: str, canonical_id: str, node_path: str, raw: dict[str, Any]
    ) -> dict[str, Any]:
        identity = raw.get("identity")
        if isinstance(identity, list):
            identity = identity[0] if identity else None
        return {
            "source_system": SOURCE_SYSTEM,
            "source_object_id": raw.get("objectId"),
            "source_identity": identity,
            "source_node_path": node_path,
            "canonical_type": canonical_type,
            "canonical_id": canonical_id,
            "raw_node_hash": sha256_bytes(canonical_json(raw).encode("utf-8")),
            "transform_version": CONVERTER_VERSION,
        }

    # -- unit builders -------------------------------------------------------
    def _convert_single_unit(
        self, layer_id: str, layer_pos: int, unit_pos: int, layer_qt: int,
        item: dict[str, Any], node_path: str,
        units, questions, answer_keys, explanations, provenance,
    ) -> None:
        unit_id = f"{layer_id}-u{unit_pos:02d}"
        question_id = f"{unit_id}-q01"
        title_html = item.get("title") or ""
        prompt_rt, meta = parse_richtext(title_html)
        self.note_meta(meta, f"question_prompt:{question_id}")
        image_asset = self.assets.get(item.get("imageId") or "")

        media_asset_ids: list[str] = []
        if image_asset:
            media_asset_ids.append(image_asset["id"])

        prompt = finalize_richtext(prompt_rt) if has_visible_text(prompt_rt) else None
        if meta["placeholders"]:
            if image_asset:
                # §5.3: 图片占位符由对应素材替代
                self.warn(
                    "leaf_prompt_placeholder",
                    f"题干为 <MOJiTest_URL> 图片占位符，已由 imageId 素材替代: {question_id}",
                )
            else:
                self.unresolved.append({
                    "object": question_id,
                    "issue": "题干含 <MOJiTest_URL> 占位符但无对应 imageId 资源",
                })
            if not has_visible_text(prompt_rt):
                prompt = None

        status = "complete"
        if meta["unknown_tags"]:
            self.warn("unknown_tag", f"题干含未白名单标签 {meta['unknown_tags']}: {question_id}")
            status = "needs_review"

        qtype = int(item["questionType"])
        if qtype != layer_qt:
            self.warn(
                "qtype_mismatch",
                f"叶子题型 {qtype} 与大题题型 {layer_qt} 不一致: {question_id}",
            )

        options, ok = self._build_options(question_id, item)
        if not ok:
            status = "blocked"

        questions.append({
            "record_type": "question",
            "schema_version": SCHEMA_VERSION,
            "id": question_id,
            "unit_id": unit_id,
            "question_type_id": qtype_id(qtype),
            "position": 1,
            "printed_number": self._printed_number(item),
            "prompt": prompt,
            "options": options,
            "slot_id": None,
            "media_asset_ids": media_asset_ids,
            "conversion_status": status,
            "_source_analysis": item.get("analysis") or "",
            "_source_translation": item.get("translation") or "",
            "_source_analysis_is_ok": bool(item.get("analysisisOk")),
            "_options_meta": meta,
        })
        self._emit_answer_key(question_id, item, options, answer_keys)
        self._emit_explanations(question_id, item, explanations)
        units.append({
            "record_type": "unit",
            "schema_version": SCHEMA_VERSION,
            "id": unit_id,
            "layer_id": layer_id,
            "question_type_id": qtype_id(qtype),
            "kind": "single",
            "position": unit_pos,
            "label": None,
            "materials": [],
            "slot_ids": [],
            "conversion_status": status,
            "_source_group": False,
            "_slot_bound": [], "_slot_unbound": [], "_comparison_detected": False,
        })
        provenance.append(self._prov("unit", unit_id, node_path, item))
        provenance.append(self._prov("question", question_id, node_path, item))

    def _convert_group_unit(
        self, layer_id: str, layer_pos: int, unit_pos: int, layer_qt: int,
        group: dict[str, Any], node_path: str,
        units, questions, answer_keys, explanations, provenance,
    ) -> None:
        unit_id = f"{layer_id}-u{unit_pos:02d}"
        kids = [k for k in group.get("items") or [] if k.get("dataType") == 22]
        qtype = int(group.get("questionType") or layer_qt)
        if qtype != layer_qt:
            self.warn(
                "qtype_mismatch",
                f"材料组题型 {qtype} 与大题题型 {layer_qt} 不一致: {unit_id}",
            )
        status = "complete"
        materials: list[dict[str, Any]] = []
        material_counter = 0

        def next_material_id() -> str:
            nonlocal material_counter
            material_counter += 1
            return f"{unit_id}-m{material_counter:02d}"

        # ---- passage material
        title_html = group.get("title") or ""
        passage_rt, pmeta = parse_richtext(title_html)
        self.note_meta(pmeta, f"unit_material:{unit_id}")
        g21_image = self.assets.get(group.get("imageId") or "")
        passage_is_placeholder = bool(pmeta["placeholders"]) and not has_visible_text(passage_rt)
        if pmeta["unknown_tags"]:
            self.warn("unknown_tag", f"材料正文含未白名单标签 {pmeta['unknown_tags']}: {unit_id}")
            status = "needs_review"

        unit_kind = self._unit_kind(layer_qt, qtype)
        doc_metas: list[dict[str, Any]] = []

        if has_visible_text(passage_rt) and not passage_is_placeholder:
            printed = [self._printed_number(k) or "" for k in kids]
            printed = [p for p in printed if p]
            if qtype == 23:
                rt, bound, unbound = bind_cloze_slots(passage_rt, printed, unit_id)
                if unbound:
                    self.warn(
                        "cloze_slot_unbound",
                        f"完形填空锚点未能与子题印刷题号绑定: unit={unit_id} unbound={unbound}",
                    )
                    status = "needs_review"
                passage_rt = rt
                unit_kind = "cloze"
            docs = split_comparison(passage_rt) if subject_of(qtype) == "reading" else [passage_rt["blocks"]]
            doc_metas = [{"blocks": d} for d in docs]
            if len(docs) == 2 and all(has_visible_text({"blocks": d}) for d in docs):
                unit_kind = "comparison"
                for idx, (role, blocks) in enumerate(
                    zip(("comparison_a", "comparison_b"), docs), 1
                ):
                    materials.append({
                        "id": next_material_id(),
                        "kind": "passage",
                        "role": role,
                        "language": "ja-JP",
                        "content": {"format": "jlptgo-richtext-v1", "blocks": blocks},
                        "asset_id": None,
                        "cues": None,
                    })
                self.warn(
                    "comparison_detected",
                    f"检测到 A/B 对比文章（启发式切分，需人工复核）: unit={unit_id}",
                )
                status = "needs_review"
            else:
                materials.append({
                    "id": next_material_id(),
                    "kind": "passage",
                    "role": "primary",
                    "language": "ja-JP",
                    "content": finalize_richtext(passage_rt),
                    "asset_id": None,
                    "cues": None,
                })
        elif passage_is_placeholder:
            self.warn(
                "group_passage_placeholder",
                f"材料正文为 <MOJiTest_URL> 图片占位符，由 imageId 素材替代: {unit_id}",
            )

        # ---- image material
        if g21_image:
            materials.append({
                "id": next_material_id(),
                "kind": "image",
                "role": "illustration",
                "language": None,
                "content": None,
                "asset_id": g21_image["id"],
                "cues": None,
            })

        # ---- audio material
        audio_asset = self.assets.get(group.get("mediaId") or "")
        if audio_asset:
            materials.append({
                "id": next_material_id(),
                "kind": "audio",
                "role": "primary",
                "language": "ja-JP",
                "content": None,
                "asset_id": audio_asset["id"],
                "cues": None,
            })

        # ---- transcript (subtitles with cues)
        subtitle_html = group.get("subtitle") or ""
        if subtitle_html.strip():
            cues, smeta = parse_subtitles(subtitle_html)
            self.note_meta(smeta, f"unit_transcript:{unit_id}")
            if cues:
                if smeta.get("cues_missing_time"):
                    self.warn(
                        "subtitle_time_missing",
                        f"字幕段缺失/无效时间戳 {smeta['cues_missing_time']} 段: unit={unit_id}",
                    )
                    status = "needs_review"
                if smeta["unknown_tags"]:
                    self.warn(
                        "unknown_tag",
                        f"字幕含未白名单标签 {smeta['unknown_tags']}: {unit_id}",
                    )
                if smeta["placeholders"]:
                    self.warn(
                        "subtitle_placeholder",
                        f"字幕含 <MOJiTest_URL> 图片占位符（看图题），见对应 Question 媒体: unit={unit_id}",
                    )
                materials.append({
                    "id": next_material_id(),
                    "kind": "transcript",
                    "role": "primary",
                    "language": "ja-JP",
                    "content": None,
                    "asset_id": None,
                    "cues": cues,
                })

        # ---- unit-level translation (§6 翻译归属)
        translation_html = group.get("translation") or ""
        if translation_html.strip():
            t_rt, tmeta = parse_richtext(translation_html)
            self.note_meta(tmeta, f"unit_translation:{unit_id}")
            if has_visible_text(t_rt):
                explanations.append({
                    "record_type": "explanation",
                    "schema_version": SCHEMA_VERSION,
                    "id": f"{unit_id}-exp-translation-zh-CN-r1",
                    "owner_type": "unit",
                    "owner_id": unit_id,
                    "kind": "translation",
                    "language": "zh-CN",
                    "content": finalize_richtext(t_rt),
                    "revision": 1,
                    "review_status": "unverified",
                })
            if tmeta["unknown_tags"]:
                self.warn(
                    "unknown_tag",
                    f"材料译文含未白名单标签 {tmeta['unknown_tags']}: {unit_id}",
                )

        # ---- questions
        slot_ids: list[str] = []
        bound_all: list[str] = []
        unbound_all: list[str] = []
        for qi, kid in enumerate(kids, 1):
            question_id = f"{unit_id}-q{qi:02d}"
            kqtype = int(kid["questionType"])
            if kqtype != qtype:
                self.warn(
                    "qtype_mismatch",
                    f"子题题型 {kqtype} 与材料组题型 {qtype} 不一致: {question_id}",
                )
            kstatus = "complete"
            title_html_k = kid.get("title") or ""
            prompt_rt, kmeta = parse_richtext(title_html_k)
            self.note_meta(kmeta, f"question_prompt:{question_id}")
            prompt = finalize_richtext(prompt_rt) if has_visible_text(prompt_rt) else None
            media_asset_ids: list[str] = []
            kid_image = self.assets.get(kid.get("imageId") or "")
            if kid_image:
                media_asset_ids.append(kid_image["id"])
            if kmeta["placeholders"]:
                if kid_image:
                    self.warn(
                        "leaf_prompt_placeholder",
                        f"题干为 <MOJiTest_URL> 图片占位符，已由 imageId 素材替代: {question_id}",
                    )
                else:
                    self.unresolved.append({
                        "object": question_id,
                        "issue": "题干含 <MOJiTest_URL> 占位符但无对应 imageId 资源",
                    })
                if not has_visible_text(prompt_rt):
                    prompt = None
            if kmeta["unknown_tags"]:
                self.warn(
                    "unknown_tag", f"题干含未白名单标签 {kmeta['unknown_tags']}: {question_id}"
                )
                kstatus = "needs_review"

            slot_id = None
            printed = self._printed_number(kid)
            if unit_kind == "cloze" and printed:
                slot_id = f"{unit_id}-s{printed}"
                slot_ids.append(slot_id)
            options, ok = self._build_options(question_id, kid)
            if not ok:
                kstatus = "blocked"

            questions.append({
                "record_type": "question",
                "schema_version": SCHEMA_VERSION,
                "id": question_id,
                "unit_id": unit_id,
                "question_type_id": qtype_id(kqtype),
                "position": qi,
                "printed_number": printed,
                "prompt": prompt,
                "options": options,
                "slot_id": slot_id,
                "media_asset_ids": media_asset_ids,
                "conversion_status": kstatus,
                "_source_analysis": kid.get("analysis") or "",
                "_source_translation": kid.get("translation") or "",
                "_source_analysis_is_ok": bool(kid.get("analysisisOk")),
                "_options_meta": kmeta,
            })
            self._emit_answer_key(question_id, kid, options, answer_keys)
            self._emit_explanations(question_id, kid, explanations)
            provenance.append(self._prov("question", question_id, f"{node_path}.items[{qi - 1}]", kid))
            if kstatus != "complete":
                status = kstatus

        units.append({
            "record_type": "unit",
            "schema_version": SCHEMA_VERSION,
            "id": unit_id,
            "layer_id": layer_id,
            "question_type_id": qtype_id(qtype),
            "kind": unit_kind,
            "position": unit_pos,
            "label": None,
            "materials": materials,
            "slot_ids": slot_ids,
            "conversion_status": status,
            "_source_group": True,
            "_slot_bound": bound_all, "_slot_unbound": unbound_all,
            "_comparison_detected": unit_kind == "comparison",
        })
        provenance.append(self._prov("unit", unit_id, node_path, group))

    def _unit_kind(self, layer_qt: int, qtype: int) -> str:
        subject = subject_of(qtype)
        if subject == "listening":
            return "audio"
        if subject == "reading":
            return "passage"
        if qtype == 23:
            return "cloze"
        return "single"

    def _printed_number(self, item: dict[str, Any]) -> str | None:
        identity = item.get("identity")
        if isinstance(identity, list) and identity:
            # 文字/文法/读解: "*NN"；听力: "*N番"；
            # 听力統合理解: "*NN*質問M"（一份音频多道印刷题），原样保留「質問M」
            m = re.search(r"\*(\d+)(番|\*質問\d+)?$", identity[0])
            if m:
                if m.group(2) and "質問" in m.group(2):
                    return m.group(2).lstrip("*")
                return m.group(1) + (m.group(2) or "")
        return None

    def _build_options(self, question_id: str, item: dict[str, Any]) -> tuple[list[dict[str, Any]], bool]:
        ok = True
        raw_options = item.get("options") or []
        if len(raw_options) < 2:
            self.warn(
                "options_too_few",
                f"选项少于 2 项 ({len(raw_options)}): {question_id}",
            )
            ok = False
        options = []
        seen_positions: set[int] = set()
        for oi, raw in enumerate(raw_options, 1):
            if oi in seen_positions:
                self.warn("option_position_duplicate", f"选项顺序重复: {question_id} pos={oi}")
                ok = False
            seen_positions.add(oi)
            rt, meta = parse_richtext(str(raw))
            self.note_meta(meta, f"option:{question_id}")
            if meta["unknown_tags"]:
                self.warn(
                    "unknown_tag",
                    f"选项含未白名单标签 {meta['unknown_tags']}: {question_id} o{oi}",
                )
            options.append({
                "id": f"{question_id}-o{oi}",
                "position": oi,
                "content": finalize_richtext(rt),
                "media_asset_ids": [],
            })
        ids = [o["id"] for o in options]
        if len(set(ids)) != len(ids):
            self.warn("option_id_duplicate", f"选项 ID 重复: {question_id}")
            ok = False
        return options, ok

    def _emit_answer_key(
        self, question_id: str, item: dict[str, Any], options: list[dict[str, Any]], answer_keys
    ) -> None:
        raw = item.get("rightAnswer")
        try:
            idx = int(str(raw))
        except (TypeError, ValueError):
            self.unresolved.append({
                "object": question_id,
                "issue": f"rightAnswer 无法解析为整数索引: {raw!r}",
            })
            return
        if not (0 <= idx < len(options)):
            self.unresolved.append({
                "object": question_id,
                "issue": f"rightAnswer 索引越界: {idx} (options={len(options)})",
            })
            return
        answer_keys.append({
            "record_type": "answer_key",
            "schema_version": SCHEMA_VERSION,
            "question_id": question_id,
            "revision": 1,
            "answer_mode": "single_choice",
            "correct_option_ids": [options[idx]["id"]],
            "review_status": "unverified",
            "source_answer_index": idx,
        })

    def _emit_explanations(self, question_id: str, item: dict[str, Any], explanations) -> None:
        analysis = (item.get("analysis") or "").strip()
        if analysis:
            blocks = [
                {"type": "paragraph", "children": [{"type": "text", "text": line}]}
                for line in re.split(r"\r\n|\r|\n", analysis)
                if line.strip()
            ]
            explanations.append({
                "record_type": "explanation",
                "schema_version": SCHEMA_VERSION,
                "id": f"{question_id}-exp-analysis-zh-CN-r1",
                "owner_type": "question",
                "owner_id": question_id,
                "kind": "analysis",
                "language": "zh-CN",
                "content": {"format": "jlptgo-richtext-v1", "blocks": blocks},
                "revision": 1,
                "review_status": "unverified",
            })
        leaf_translation = (item.get("translation") or "").strip()
        if leaf_translation:
            rt, meta = parse_richtext(leaf_translation)
            self.note_meta(meta, f"leaf_translation:{question_id}")
            if has_visible_text(rt):
                explanations.append({
                    "record_type": "explanation",
                    "schema_version": SCHEMA_VERSION,
                    "id": f"{question_id}-exp-translation-zh-CN-r1",
                    "owner_type": "question",
                    "owner_id": question_id,
                    "kind": "translation",
                    "language": "zh-CN",
                    "content": finalize_richtext(rt),
                    "revision": 1,
                    "review_status": "unverified",
                })

    # -- public record shaping ----------------------------------------------
    def _public_unit(self, u: dict[str, Any]) -> dict[str, Any]:
        return {k: v for k, v in u.items() if not k.startswith("_")}

    def _public_question(self, q: dict[str, Any]) -> dict[str, Any]:
        return {k: v for k, v in q.items() if not k.startswith("_")}

    # -- structural validation (§7.1) ----------------------------------------
    def validate(
        self, counts, sections, layers, units, questions, answer_keys, assets, explanations
    ) -> dict[str, Any]:
        errors: list[str] = []
        checks: list[dict[str, Any]] = []

        def check(name: str, ok: bool, detail: str = "") -> None:
            checks.append({"check": name, "ok": bool(ok), "detail": detail})
            if not ok:
                errors.append(f"{name}: {detail}" if detail else name)

        section_ids = {s["id"] for s in sections}
        layer_ids = {l["id"] for l in layers}
        layer_by_id = {l["id"]: l for l in layers}
        unit_ids = {u["id"] for u in units}
        unit_by_id = {u["id"]: u for u in units}
        question_ids = {q["id"] for q in questions}
        asset_ids = {a["id"] for a in assets}
        qt_ids = set()
        for qt in self._used_qtypes(layers, units, questions):
            qt_ids.add(qtype_id(qt))

        check("ids_unique", len(question_ids) == len(questions) and len(unit_ids) == len(units)
              and len(layer_ids) == len(layers))
        check("layers_fk_section", all(
            f"{self.exam_id}-sec-{l['section']}" in section_ids for l in layers))
        check("units_fk_layer", all(u["layer_id"] in layer_ids for u in units))
        check("questions_fk_unit", all(q["unit_id"] in unit_ids for q in questions))
        check("question_types_resolvable", all(
            q["question_type_id"] in qt_ids for q in questions) and all(
            l["question_type_id"] in qt_ids for l in layers))
        check("unit_has_question", all(
            any(q["unit_id"] == uid for q in questions) for uid in unit_ids))
        check("single_unit_exactly_one_question", all(
            sum(1 for q in questions if q["unit_id"] == u["id"]) == 1
            for u in units if u["kind"] == "single"))

        pos_dupe = []
        for lid, layer in layer_by_id.items():
            seen: set[int] = set()
            for u in units:
                if u["layer_id"] == lid:
                    if u["position"] in seen:
                        pos_dupe.append(u["id"])
                    seen.add(u["position"])
        check("unit_position_unique_positive", not pos_dupe
              and all(u["position"] >= 1 for u in units), str(pos_dupe))

        qpos_dupe = []
        for uid in unit_ids:
            seen = set()
            for q in questions:
                if q["unit_id"] == uid:
                    if q["position"] in seen:
                        qpos_dupe.append(q["id"])
                    seen.add(q["position"])
        check("question_position_unique_positive", not qpos_dupe, str(qpos_dupe))

        bad_options = []
        for q in questions:
            opts = q["options"]
            if len(opts) < 2:
                bad_options.append(q["id"])
            positions = [o["position"] for o in opts]
            if len(set(positions)) != len(positions) or positions != sorted(positions):
                bad_options.append(q["id"])
            opt_ids = [o["id"] for o in opts]
            if len(set(opt_ids)) != len(opt_ids):
                bad_options.append(q["id"])
        check("options_valid", not bad_options, str(bad_options))

        q_by_id = {q["id"]: q for q in questions}
        bad_keys = []
        for k in answer_keys:
            q = q_by_id.get(k["question_id"])
            if q is None:
                bad_keys.append(k["question_id"])
                continue
            valid_ids = {o["id"] for o in q["options"]}
            if len(k["correct_option_ids"]) != 1 or k["correct_option_ids"][0] not in valid_ids:
                bad_keys.append(k["question_id"])
        check("answer_keys_valid", len(answer_keys) == len(questions) and not bad_keys,
              f"{len(questions) - len(answer_keys)} missing; bad={bad_keys}")

        referenced_assets: set[str] = set()
        for q in questions:
            referenced_assets.update(q["media_asset_ids"])
            for o in q["options"]:
                referenced_assets.update(o.get("media_asset_ids") or [])
        for u in units:
            for m in u["materials"]:
                if m.get("asset_id"):
                    referenced_assets.add(m["asset_id"])
        exam_full_audio = getattr(self, "full_audio_asset_id", None)
        if exam_full_audio:
            referenced_assets.add(exam_full_audio)
        missing = referenced_assets - asset_ids
        check("media_refs_resolvable", not missing, str(sorted(missing)))
        check("media_binaries_available", all(
            a["availability"] in ("verified",) for a in assets),
            str([a["id"] for a in assets if a["availability"] != "verified"]))

        slot_ok = True
        slot_detail = []
        for u in units:
            unit_slots = {m_block_slot for m in u["materials"]
                          for b in (m.get("content") or {}).get("blocks", [])
                          for m_block_slot in self._slots_of_block(b)}
            if u["slot_ids"] and not unit_slots:
                slot_ok = False
                slot_detail.append(f"{u['id']}: slot_ids 未出现在富文本中")
            for q in questions:
                if q["unit_id"] == u["id"] and q["slot_id"]:
                    if q["slot_id"] not in u["slot_ids"]:
                        slot_ok = False
                        slot_detail.append(f"{q['id']}: slot_id 不在 Unit.slot_ids")
        check("cloze_slots_bound", slot_ok, "; ".join(slot_detail))

        explanation_owner_ok = all(
            (e["owner_type"] == "question" and e["owner_id"] in question_ids)
            or (e["owner_type"] == "unit" and e["owner_id"] in unit_ids)
            for e in explanations
        )
        check("explanation_owners_valid", explanation_owner_ok)

        counts_match = (
            counts["layers"] == len(layers)
            and counts["units"] == len(units)
            and counts["questions"] == len(questions)
            and counts["assets"] == len(assets)
        )
        check("manifest_counts_match", counts_match)

        return {
            "passed": not errors,
            "error_count": len(errors),
            "checks": checks,
            "errors": errors,
        }

    @staticmethod
    def _slots_of_block(block: dict[str, Any]) -> list[str]:
        out = []
        for child in block.get("children", []):
            if child.get("type") == "slot":
                out.append(child.get("slot_id"))
        return out

    def _used_qtypes(self, layers, units, questions) -> set[int]:
        ids = {l["question_type_id"] for l in layers} | {
            u["question_type_id"] for u in units
        } | {q["question_type_id"] for q in questions}
        return {code for code, semantic in QUESTION_TYPE_IDS.items() if semantic in ids}


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

SELECTIONS = {
    "N5": "KDXBNKaPMJ",   # 2018-07, 91 questions
    "N4": "yxeDN6rPmR",   # 2018-07, 98 questions
    "N3": "JIcIGb0sPS",   # 2025-12, 101 questions (newest scrape layout)
    "N2": "1EPlaLzGnX",   # 2018-12, 103 questions (schema baseline sample)
    "N1": "mvgz7C99A7",   # 2018-12, 105 questions
}

N2_BASELINE = {
    "layers": 19,
    "source_groups_21": 41,
    "single_units": 47,
    "units": 88,
    "questions": 103,
    "assets": 37,
}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=Path(__file__).parent / "data")
    parser.add_argument("--output-dir", type=Path, default=Path(__file__).parent / "data" / "normalized_v2")
    parser.add_argument("--level", action="append", help="restrict to one level; repeatable")
    args = parser.parse_args()

    summary = {}
    for level, oid in SELECTIONS.items():
        if args.level and level not in args.level:
            continue
        exam_dir = args.data_dir / level / oid
        metadata = json.loads((exam_dir / "metadata.json").read_text(encoding="utf-8"))
        package_id = f"JLPTGO-{level}-{metadata['year']}-{metadata['month']:02d}-r1"
        out_dir = args.output_dir / package_id
        result = Converter(exam_dir, out_dir).convert()
        if level == "N2":
            mismatches = {
                k: (result["counts"].get(k), v)
                for k, v in N2_BASELINE.items()
                if result["counts"].get(k) != v
            }
            result["n2_baseline_mismatch"] = mismatches or "all match"
        summary[level] = result

    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
