"""Structural validation for a Canonical package (import-spec steps 4–5).

Produces issues with severity 'error' (blocks staging) or 'warning'
(recorded in the import report / record issues, e.g. needs_review markers).
Content correctness and publication rights are NOT validated here.
"""
from dataclasses import dataclass, field

from app.importer.reader import CanonicalPackage

RICHTEXT_FORMAT = "jlptgo-richtext-v1"
RICHTEXT_BLOCK_TYPES = {"paragraph", "heading", "list", "table", "image"}
RICHTEXT_CHILD_TYPES = {"text", "ruby", "slot", "break"}
EXAM_LEVELS = {"N1", "N2", "N3", "N4", "N5"}
EXAM_KINDS = {"past_exam", "mock_exam"}
SUBJECTS = {"vocabulary", "grammar", "reading", "listening"}
UNIT_KINDS = {"single", "passage", "cloze", "comparison", "visual", "audio"}
MATERIAL_KINDS = {"passage", "image", "audio", "transcript", "instruction"}
EXPLANATION_KINDS = {"analysis", "translation", "note"}
ANSWER_MODES = {"single_choice"}
CONVERSION_STATUSES = {"complete", "needs_review", "blocked"}
REVIEW_STATUSES = {"missing", "unverified", "agent_checked", "human_reviewed", "disputed"}
ANSWER_KEY_REVIEW_STATUSES = {"unverified", "agent_checked", "human_reviewed", "disputed"}
ASSET_AVAILABILITY = {"verified", "missing", "corrupt", "unchecked"}


@dataclass
class Issue:
    severity: str  # 'error' | 'warning'
    code: str
    location: str
    message: str

    def as_dict(self) -> dict:
        return {
            "severity": self.severity,
            "code": self.code,
            "location": self.location,
            "message": self.message,
        }


@dataclass
class ValidationResult:
    issues: list[Issue] = field(default_factory=list)
    counts: dict[str, int] = field(default_factory=dict)

    @property
    def errors(self) -> list[Issue]:
        return [i for i in self.issues if i.severity == "error"]

    @property
    def warnings(self) -> list[Issue]:
        return [i for i in self.issues if i.severity == "warning"]

    def error(self, code: str, location: str, message: str) -> None:
        self.issues.append(Issue("error", code, location, message))

    def warning(self, code: str, location: str, message: str) -> None:
        self.issues.append(Issue("warning", code, location, message))


def _iter_richtext_children(content: dict):
    for block in content.get("blocks", []):
        for child in block.get("children", []) or []:
            yield child


def richtext_slots(content) -> set[str]:
    if not isinstance(content, dict):
        return set()
    return {
        c["slot_id"] for c in _iter_richtext_children(content)
        if c.get("type") == "slot" and c.get("slot_id")
    }


def richtext_asset_ids(content) -> set[str]:
    if not isinstance(content, dict):
        return set()
    return {
        b["asset_id"] for b in content.get("blocks", [])
        if b.get("type") == "image" and b.get("asset_id")
    }


def _validate_richtext(vr: ValidationResult, content, location: str) -> None:
    if content is None:
        return
    if not isinstance(content, dict) or content.get("format") != RICHTEXT_FORMAT:
        vr.error("richtext_format", location, f"expected format {RICHTEXT_FORMAT!r}")
        return
    for i, block in enumerate(content.get("blocks", [])):
        if block.get("type") not in RICHTEXT_BLOCK_TYPES:
            vr.error("richtext_block", f"{location}.blocks[{i}]",
                     f"unknown block type {block.get('type')!r}")
        if block.get("type") == "image" and not block.get("asset_id"):
            vr.error("richtext_image_asset", f"{location}.blocks[{i}]",
                     "image block missing asset_id")
        for j, child in enumerate(block.get("children", []) or []):
            if child.get("type") not in RICHTEXT_CHILD_TYPES:
                vr.error("richtext_child", f"{location}.blocks[{i}].children[{j}]",
                         f"unknown child type {child.get('type')!r}")


def _positive_int(value) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value > 0


def _validate_phases(vr: ValidationResult, package: CanonicalPackage,
                     exam_id: str) -> None:
    """Strict-mock Phases (ADR-0019). Optional: a package without phases is
    simply not mockable. When present, every Unit must belong to exactly one
    Phase (via its section subject) and no Phase may be empty — a partial
    mock would silently skip content."""
    rec = package.records
    loc = package.package_id
    phases = rec.get("phases.jsonl", [])
    if not phases:
        return
    seen_ids: set[str] = set()
    seen_pos: set[int] = set()
    subject_phase: dict[str, str] = {}
    for ph in phases:
        pid = ph.get("id")
        ploc = f"{loc}.phase[{pid}]"
        if ph.get("record_type") != "exam_phase":
            vr.error("record_type", ploc, f"expected 'exam_phase', got {ph.get('record_type')!r}")
        if pid in seen_ids:
            vr.error("duplicate_id", ploc, "duplicate id within package")
        seen_ids.add(pid)
        if ph.get("exam_id") != exam_id:
            vr.error("fk_phase_exam", ploc, f"exam_id {ph.get('exam_id')!r} does not match exam")
        pos = ph.get("position")
        if not _positive_int(pos) or pos in seen_pos:
            vr.error("phase_position", ploc, f"position must be a unique positive int, got {pos!r}")
        else:
            seen_pos.add(pos)
        if not ph.get("title"):
            vr.error("phase_title", ploc, "title required")
        if not _positive_int(ph.get("duration_seconds")):
            vr.error("phase_duration", ploc,
                     f"duration_seconds must be a positive int, got {ph.get('duration_seconds')!r}")
        subjects = ph.get("subjects")
        if (not isinstance(subjects, list) or not subjects
                or any(s not in SUBJECTS for s in subjects)):
            vr.error("phase_subjects", ploc, f"subjects must be a non-empty list of {sorted(SUBJECTS)}")
            continue
        for s in subjects:
            if s in subject_phase:
                vr.error("phase_subject_overlap", ploc,
                         f"subject {s!r} already belongs to phase {subject_phase[s]!r}")
            subject_phase[s] = pid
        pol = ph.get("playback_policy")
        if pol is not None and not isinstance(pol, dict):
            vr.error("phase_playback_policy", ploc, "playback_policy must be an object or null")

    layer_subject = {l["id"]: l.get("section") for l in rec["layers.jsonl"]}
    covered: dict[str, int] = {pid: 0 for pid in seen_ids}
    for u in rec["units.jsonl"]:
        pid = subject_phase.get(layer_subject.get(u.get("layer_id")))
        if pid is None:
            vr.error("phase_unit_uncovered", f"{loc}.unit[{u.get('id')}]",
                     "unit's section subject belongs to no phase")
        else:
            covered[pid] += 1
    for pid, n in covered.items():
        if n == 0:
            vr.error("phase_empty", f"{loc}.phase[{pid}]", "phase contains no units")


def validate_package(package: CanonicalPackage) -> ValidationResult:
    vr = ValidationResult()
    rec = package.records
    loc = package.package_id

    exam_records = rec["exam.json"]
    if len(exam_records) != 1:
        vr.error("exam_count", loc, f"exam.json must contain exactly 1 record, got {len(exam_records)}")
        return vr
    exam = exam_records[0]
    exam_id = exam.get("id")
    if not exam_id:
        vr.error("exam_id", f"{loc}.exam", "exam.id missing")
        return vr

    sections = {r["id"]: r for r in rec["sections.jsonl"]}
    # Real converter emits layers with (exam_id, section=subject); the spec
    # doc's `section_id` field does not exist in current packages.
    sections_by_subject = {(r["exam_id"], r["subject"]): r for r in rec["sections.jsonl"]}
    layers = {r["id"]: r for r in rec["layers.jsonl"]}
    units = {r["id"]: r for r in rec["units.jsonl"]}
    question_types = {r["id"]: r for r in rec["question_types.jsonl"]}
    assets = {r["id"]: r for r in rec["assets.jsonl"]}
    questions_by_id: dict[str, dict] = {}
    questions_by_unit: dict[str, list[dict]] = {}
    for q in rec["questions.jsonl"]:
        questions_by_id[q["id"]] = q
        questions_by_unit.setdefault(q["unit_id"], []).append(q)
    answer_keys = {r["question_id"]: r for r in rec["answer_keys.private.jsonl"]}

    # --- exam -------------------------------------------------------------
    if exam.get("record_type") != "exam":
        vr.error("record_type", f"{loc}.exam", f"expected 'exam', got {exam.get('record_type')!r}")
    if exam.get("level") not in EXAM_LEVELS:
        vr.error("exam_level", f"{loc}.exam", f"invalid level {exam.get('level')!r}")
    if not _positive_int(exam.get("month")) or exam["month"] > 12:
        vr.error("exam_month", f"{loc}.exam", f"invalid month {exam.get('month')!r}")
    if exam.get("kind") not in EXAM_KINDS:
        vr.error("exam_kind", f"{loc}.exam", f"invalid kind {exam.get('kind')!r}")
    if exam.get("status") not in {"draft", "review", "published", "archived"}:
        vr.error("exam_status", f"{loc}.exam", f"invalid status {exam.get('status')!r}")
    if not exam.get("title"):
        vr.error("exam_title", f"{loc}.exam", "title must be non-empty")
    full_audio = exam.get("full_audio_asset_id")
    if full_audio and full_audio not in assets:
        vr.error("asset_ref", f"{loc}.exam.full_audio_asset_id", f"unknown asset {full_audio!r}")

    # --- question_types ---------------------------------------------------
    for qt in rec["question_types.jsonl"]:
        qloc = f"{loc}.question_type[{qt['id']}]"
        if qt.get("subject") not in SUBJECTS:
            vr.error("qt_subject", qloc, f"invalid subject {qt.get('subject')!r}")
        if not qt.get("label_zh") or not qt.get("label_ja"):
            vr.error("qt_label", qloc, "label_zh and label_ja required")
        if qt.get("answer_mode") not in ANSWER_MODES:
            vr.error("qt_answer_mode", qloc, f"invalid answer_mode {qt.get('answer_mode')!r}")
        stc = qt.get("source_type_code")
        if stc is not None and (not isinstance(stc, int) or isinstance(stc, bool)):
            vr.error("qt_source_type_code", qloc, f"source_type_code must be int or absent, got {stc!r}")
        prov = qt.get("_provisional")
        if prov is not None and not isinstance(prov, bool):
            vr.error("qt_provisional", qloc, f"_provisional must be bool or absent, got {prov!r}")

    # --- uniqueness -------------------------------------------------------
    for name, rows in (("section", rec["sections.jsonl"]), ("layer", rec["layers.jsonl"]),
                       ("unit", rec["units.jsonl"]), ("question_type", rec["question_types.jsonl"]),
                       ("asset", rec["assets.jsonl"]), ("question", rec["questions.jsonl"])):
        seen: set[str] = set()
        for r in rows:
            rid = r.get("id")
            if rid in seen:
                vr.error("duplicate_id", f"{loc}.{name}[{rid}]", "duplicate id within package")
            seen.add(rid)
    ak_seen: set[str] = set()
    for r in rec["answer_keys.private.jsonl"]:
        qid = r.get("question_id")
        if qid in ak_seen:
            vr.error("duplicate_id", f"{loc}.answer_key[{qid}]", "duplicate answer key for question")
        ak_seen.add(qid)

    # --- sections ---------------------------------------------------------
    for s in rec["sections.jsonl"]:
        sloc = f"{loc}.section[{s['id']}]"
        if s.get("record_type") != "section":
            vr.error("record_type", sloc, f"expected 'section', got {s.get('record_type')!r}")
        if s.get("exam_id") != exam_id:
            vr.error("fk_section_exam", sloc, f"exam_id {s.get('exam_id')!r} does not match exam")
        if s.get("subject") not in SUBJECTS:
            vr.error("section_subject", sloc, f"invalid subject {s.get('subject')!r}")
        if not s.get("title"):
            vr.error("section_title", sloc, "title required")
        if not _positive_int(s.get("position")):
            vr.error("position", sloc, f"invalid position {s.get('position')!r}")

    # --- layers -----------------------------------------------------------
    for l in rec["layers.jsonl"]:
        lloc = f"{loc}.layer[{l['id']}]"
        if l.get("record_type") != "layer":
            vr.error("record_type", lloc, f"expected 'layer', got {l.get('record_type')!r}")
        if l.get("exam_id") != exam_id:
            vr.error("fk_layer_exam", lloc, f"exam_id {l.get('exam_id')!r} does not match exam")
        section = sections_by_subject.get((l.get("exam_id"), l.get("section")))
        if section is None:
            vr.error("fk_layer_section", lloc,
                     f"no section with exam_id={l.get('exam_id')!r}, subject={l.get('section')!r}")
        if l.get("question_type_id") not in question_types:
            vr.error("fk_layer_question_type", lloc,
                     f"unknown question_type_id {l.get('question_type_id')!r}")
        if not _positive_int(l.get("position")):
            vr.error("position", lloc, f"invalid position {l.get('position')!r}")
        _validate_richtext(vr, l.get("instruction"), f"{lloc}.instruction")

    # --- assets -----------------------------------------------------------
    for a in rec["assets.jsonl"]:
        aloc = f"{loc}.asset[{a['id']}]"
        sha = a.get("sha256")
        if not isinstance(sha, str) or len(sha) != 64:
            vr.error("asset_sha256", aloc, "sha256 must be a 64-char hex string")
        if not a.get("storage_key") or not a.get("mime_type"):
            vr.error("asset_fields", aloc, "storage_key and mime_type required")
        for numfield in ("size_bytes", "duration_ms"):
            val = a.get(numfield)
            if val is not None and (not isinstance(val, int) or isinstance(val, bool) or val < 0):
                vr.error("asset_field", aloc, f"{numfield} must be a non-negative int or null")
        if a.get("availability") not in ASSET_AVAILABILITY:
            vr.error("asset_availability", aloc, f"invalid availability {a.get('availability')!r}")

    # --- units + materials ------------------------------------------------
    for u in rec["units.jsonl"]:
        uloc = f"{loc}.unit[{u['id']}]"
        if u.get("record_type") != "unit":
            vr.error("record_type", uloc, f"expected 'unit', got {u.get('record_type')!r}")
        if u.get("layer_id") not in layers:
            vr.error("fk_unit_layer", uloc, f"unknown layer_id {u.get('layer_id')!r}")
        if u.get("question_type_id") not in question_types:
            vr.error("fk_unit_question_type", uloc,
                     f"unknown question_type_id {u.get('question_type_id')!r}")
        if u.get("kind") not in UNIT_KINDS:
            vr.error("unit_kind", uloc, f"invalid kind {u.get('kind')!r}")
        if not _positive_int(u.get("position")):
            vr.error("position", uloc, f"invalid position {u.get('position')!r}")
        if u.get("conversion_status") not in CONVERSION_STATUSES:
            vr.error("conversion_status", uloc, f"invalid conversion_status {u.get('conversion_status')!r}")
        if u.get("conversion_status") != "complete":
            vr.warning("unit_conversion", uloc,
                       f"conversion_status={u.get('conversion_status')!r}; unit blocked from publish gate")
        slot_ids = u.get("slot_ids")
        if not isinstance(slot_ids, list) or any(not isinstance(s, str) for s in slot_ids):
            vr.error("unit_slots", uloc, "slot_ids must be a list of strings")
            slot_ids = []
        if len(set(slot_ids)) != len(slot_ids):
            vr.error("unit_slots", uloc, "duplicate slot_ids")

        unit_slots_in_text: set[str] = set()
        materials = u.get("materials", [])
        if not isinstance(materials, list):
            vr.error("unit_materials", uloc, "materials must be a list")
            materials = []
        # Unit material grouping: cue-bearing materials are timed against the
        # unit's own audio; zero or multiple audio materials is a grouping
        # anomaly to record, never to guess away.
        audio_asset_ids = [m.get("asset_id") for m in materials
                           if m.get("kind") == "audio" and m.get("asset_id")]
        seen_mat_pos: set[int] = set()
        seen_mat_ids: set[str] = set()
        has_media = False
        for i, m in enumerate(materials):
            mloc = f"{uloc}.materials[{i}]"
            mid = m.get("id")
            if not mid or mid in seen_mat_ids:
                vr.error("material_id", mloc, f"missing or duplicate material id {mid!r}")
            seen_mat_ids.add(mid)
            if m.get("kind") not in MATERIAL_KINDS:
                vr.error("material_kind", mloc, f"invalid kind {m.get('kind')!r}")
            # Canonical Material has no position field; array order is the
            # source of truth (a position is assigned in the DB projection).
            if m.get("position") is not None:
                if not _positive_int(m["position"]):
                    vr.error("position", mloc, f"invalid position {m['position']!r}")
                elif m["position"] in seen_mat_pos:
                    vr.error("material_position", mloc, f"duplicate position {m['position']}")
                seen_mat_pos.add(m["position"])
            _validate_richtext(vr, m.get("content"), f"{mloc}.content")
            unit_slots_in_text |= richtext_slots(m.get("content"))
            asset_id = m.get("asset_id")
            if asset_id is not None and asset_id not in assets:
                vr.error("asset_ref", mloc, f"unknown asset {asset_id!r}")
            if asset_id is not None or m.get("kind") in ("image", "audio"):
                has_media = True
            cues = m.get("cues")
            if cues is not None:
                if not isinstance(cues, list):
                    vr.error("material_cues", mloc, "cues must be a list")
                else:
                    prev_end = -1
                    for j, cue in enumerate(cues):
                        cloc = f"{mloc}.cues[{j}]"
                        start, end = cue.get("start_ms"), cue.get("end_ms")
                        if not _positive_int(cue.get("index")):
                            vr.warning("cue_index", cloc,
                                       f"invalid cue index {cue.get('index')!r}")
                        if start is None or end is None:
                            # Missing timestamps are distinct from an explicit 0
                            # start (0 is legal); never guess, flag for review.
                            vr.warning("cue_time_missing", cloc,
                                       f"cue missing timestamp (start_ms={start!r}, end_ms={end!r}); marked needs_review, not guessed")
                        elif not (isinstance(start, int) and isinstance(end, int)
                                  and not isinstance(start, bool)
                                  and 0 <= start < end):
                            vr.warning("cue_time_invalid", cloc,
                                       f"invalid cue times ({start!r},{end!r}); marked needs_review, not guessed")
                        elif start < prev_end:
                            vr.warning("cue_order", cloc, "cue overlaps or is out of order")
                        else:
                            if prev_end >= 0 and start - prev_end > 10_000:
                                vr.warning("cue_gap_large", cloc,
                                           f"{start - prev_end}ms gap after previous cue; needs review")
                            prev_end = end
                if cues and not audio_asset_ids:
                    vr.warning("material_grouping", mloc,
                               "cue-bearing material has no paired unit"
                               " audio; timeline cannot be anchored")
                elif cues and len(audio_asset_ids) > 1:
                    vr.warning("material_grouping", mloc,
                               f"{len(audio_asset_ids)} audio materials in"
                               " one unit; cue timeline anchor ambiguous")
            tfm = m.get("translated_from_material_id")
            if tfm is not None and tfm not in seen_mat_ids:
                # forward reference allowed only if it appears later in the same unit
                later_ids = {mm.get("id") for mm in materials[i + 1:]}
                if tfm not in later_ids:
                    vr.error("material_translation_ref", mloc,
                             f"translated_from_material_id {tfm!r} not found in unit materials")

        # Cue timeline bounds vs the unit's own audio asset: the timeline is
        # relative to the unit audio (not the whole-exam file); when the audio
        # binary is verified with a known duration, an overrunning timeline is
        # a data-quality issue to review, not something to guess away.
        for m in materials:
            cues = m.get("cues") or []
            ends = [c.get("end_ms") for c in cues
                    if isinstance(c.get("end_ms"), int)
                    and not isinstance(c.get("end_ms"), bool)]
            if not ends or not audio_asset_ids:
                continue
            max_end = max(ends)
            for aid in audio_asset_ids:
                asset = assets.get(aid) or {}
                if (asset.get("availability") == "verified"
                        and asset.get("duration_ms")
                        and max_end > asset["duration_ms"]):
                    vr.warning("cue_over_duration",
                               f"{uloc}.material[{m.get('id')}]",
                               f"cue timeline ends at {max_end}ms beyond verified"
                               f" audio duration {asset['duration_ms']}ms; needs review")

        # cloze slot binding (7.1): slots must exist in unit text or be flagged,
        # never silently accepted; question.slot_id must belong to the unit.
        if u.get("kind") == "cloze":
            if not slot_ids:
                vr.warning("cloze_slots", uloc,
                           "cloze unit has no slot_ids; conversion needs review")
            for s in slot_ids:
                if s not in unit_slots_in_text:
                    vr.warning("cloze_slot_anchor", f"{uloc}.slot[{s}]",
                               "slot not found in unit richtext; marked needs_review, position not guessed")

        qs = questions_by_unit.get(u["id"], [])
        if not qs:
            vr.error("unit_empty", uloc, "unit has no questions")
        elif u.get("kind") == "single" and len(qs) != 1:
            vr.error("unit_single_count", uloc,
                     f"single unit must have exactly 1 question, got {len(qs)}")
        elif u.get("kind") != "single" and len(qs) == 1:
            pass  # allowed: passage with one question is legitimate
        if not qs and not materials and not has_media:
            vr.warning("unit_no_content", uloc, "unit has no questions, materials or media")

    # --- questions + options ----------------------------------------------
    for q in rec["questions.jsonl"]:
        qloc = f"{loc}.question[{q['id']}]"
        if q.get("record_type") != "question":
            vr.error("record_type", qloc, f"expected 'question', got {q.get('record_type')!r}")
        unit = units.get(q.get("unit_id"))
        if unit is None:
            vr.error("fk_question_unit", qloc, f"unknown unit_id {q.get('unit_id')!r}")
            continue
        if q.get("question_type_id") not in question_types:
            vr.error("fk_question_question_type", qloc,
                     f"unknown question_type_id {q.get('question_type_id')!r}")
        if not _positive_int(q.get("position")):
            vr.error("position", qloc, f"invalid position {q.get('position')!r}")
        pn = q.get("printed_number")
        if pn is not None and not isinstance(pn, str):
            vr.error("printed_number", qloc, f"printed_number must be a string or null, got {type(pn).__name__}")
        _validate_richtext(vr, q.get("prompt"), f"{qloc}.prompt")
        if q.get("conversion_status") not in CONVERSION_STATUSES:
            vr.error("conversion_status", qloc, f"invalid conversion_status {q.get('conversion_status')!r}")
        if q.get("conversion_status") != "complete":
            vr.warning("question_conversion", qloc,
                       f"conversion_status={q.get('conversion_status')!r}; flagged for review")

        slot_id = q.get("slot_id")
        unit_slot_ids = unit.get("slot_ids") or []
        if slot_id is not None:
            if slot_id not in unit_slot_ids:
                vr.error("slot_binding", qloc,
                         f"slot_id {slot_id!r} not declared in unit slot_ids")

        media_ids = q.get("media_asset_ids", [])
        if not isinstance(media_ids, list):
            vr.error("question_media", qloc, "media_asset_ids must be a list")
            media_ids = []
        for aid in media_ids:
            if aid not in assets:
                vr.error("asset_ref", f"{qloc}.media", f"unknown asset {aid!r}")

        prompt_asset_ids = richtext_asset_ids(q.get("prompt"))
        for aid in prompt_asset_ids:
            if aid not in assets:
                vr.error("asset_ref", f"{qloc}.prompt", f"unknown asset {aid!r}")

        options = q.get("options", [])
        if not isinstance(options, list) or len(options) < 2:
            vr.error("options_count", qloc,
                     f"single-choice question needs at least 2 options, got {len(options) if isinstance(options, list) else 'non-list'}")
            options = []
        seen_opt_pos: set[int] = set()
        seen_opt_ids: set[str] = set()
        option_ids: set[str] = set()
        for o in options:
            oloc = f"{qloc}.option[{o.get('id')}]"
            oid = o.get("id")
            if not oid or oid in seen_opt_ids:
                vr.error("option_id", oloc, f"missing or duplicate option id {oid!r}")
            seen_opt_ids.add(oid)
            option_ids.add(oid)
            if not _positive_int(o.get("position")):
                vr.error("position", oloc, f"invalid position {o.get('position')!r}")
            elif o["position"] in seen_opt_pos:
                vr.error("option_position", oloc, f"duplicate position {o['position']}")
            seen_opt_pos.add(o.get("position"))
            _validate_richtext(vr, o.get("content"), f"{oloc}.content")
            for aid in o.get("media_asset_ids", []) or []:
                if aid not in assets:
                    vr.error("asset_ref", oloc, f"unknown asset {aid!r}")

        if q.get("prompt") is None and not media_ids and not prompt_asset_ids \
                and not (unit.get("materials") or []):
            vr.warning("question_no_content", qloc,
                       "prompt is null without question/unit media; needs review")

        # --- answer key ---------------------------------------------------
        ak = answer_keys.get(q["id"])
        if ak is None:
            vr.warning("answer_key_missing", qloc, "no answer key; question cannot be scored")
        else:
            akloc = f"{loc}.answer_key[{q['id']}]"
            if ak.get("answer_mode") not in ANSWER_MODES:
                vr.error("ak_answer_mode", akloc, f"invalid answer_mode {ak.get('answer_mode')!r}")
            if ak.get("review_status") not in ANSWER_KEY_REVIEW_STATUSES:
                vr.error("ak_review_status", akloc, f"invalid review_status {ak.get('review_status')!r}")
            if not _positive_int(ak.get("revision")):
                vr.error("ak_revision", akloc, f"invalid revision {ak.get('revision')!r}")
            correct = ak.get("correct_option_ids")
            if not isinstance(correct, list) or len(correct) != 1:
                vr.error("ak_count", akloc,
                         f"single_choice answer key must have exactly 1 correct option, got {correct!r}")
            elif ak["answer_mode"] == "single_choice":
                cid = correct[0]
                if cid not in option_ids:
                    vr.error("ak_option_ref", akloc,
                             f"correct option {cid!r} does not belong to this question")

    # --- explanations -----------------------------------------------------
    for e in rec["explanations.jsonl"]:
        eloc = f"{loc}.explanation[{e['id']}]"
        if e.get("record_type") != "explanation":
            vr.error("record_type", eloc, f"expected 'explanation', got {e.get('record_type')!r}")
        owner_type, owner_id = e.get("owner_type"), e.get("owner_id")
        if owner_type == "question":
            if owner_id not in questions_by_id:
                vr.error("fk_explanation_question", eloc, f"unknown question {owner_id!r}")
        elif owner_type == "unit":
            if owner_id not in units:
                vr.error("fk_explanation_unit", eloc, f"unknown unit {owner_id!r}")
        else:
            vr.error("explanation_owner", eloc, f"invalid owner_type {owner_type!r}")
        if e.get("kind") not in EXPLANATION_KINDS:
            vr.error("explanation_kind", eloc, f"invalid kind {e.get('kind')!r}")
        if not e.get("language"):
            vr.error("explanation_language", eloc, "language required")
        if not _positive_int(e.get("revision")):
            vr.error("explanation_revision", eloc, f"invalid revision {e.get('revision')!r}")
        if e.get("review_status") not in REVIEW_STATUSES:
            vr.error("explanation_review_status", eloc,
                     f"invalid review_status {e.get('review_status')!r}")
        _validate_richtext(vr, e.get("content"), f"{eloc}.content")

    # --- cross-record position uniqueness ----------------------------------
    def check_positions(rows: list[dict], key_fn, name: str) -> None:
        groups: dict = {}
        for r in rows:
            if not _positive_int(r.get("position")):
                continue
            groups.setdefault(key_fn(r), []).append(r["position"])
        for key, positions in groups.items():
            dupes = {p for p in positions if positions.count(p) > 1}
            for p in sorted(dupes):
                vr.error("position_duplicate", f"{loc}.{name}",
                         f"duplicate position {p} within {key!r}")

    check_positions(rec["sections.jsonl"], lambda r: exam_id, "section")
    check_positions(rec["layers.jsonl"], lambda r: (r.get("exam_id"), r.get("section")), "layer")
    check_positions(rec["units.jsonl"], lambda r: r.get("layer_id"), "unit")
    check_positions(rec["questions.jsonl"], lambda r: r.get("unit_id"), "question")

    # --- asset availability -------------------------------------------------
    for a in rec["assets.jsonl"]:
        if a.get("availability") != "verified":
            vr.warning("asset_unverified", f"{loc}.asset[{a['id']}]",
                       f"availability={a.get('availability')!r}; binary not verified by importer")

    # --- provenance ---------------------------------------------------------
    if not package.provenance:
        vr.warning("provenance_missing", loc,
                   "no provenance/source_refs.private.jsonl; source traceability absent")
    seen_mapping: set[tuple] = set()
    for p in package.provenance:
        key = (p.get("source_system"), package.source_archive_sha256,
               p.get("canonical_type"), p.get("canonical_id"))
        if key in seen_mapping:
            vr.error("provenance_duplicate", f"{loc}.provenance",
                     f"duplicate source mapping for {key}")
        seen_mapping.add(key)
        if not p.get("canonical_id") or not p.get("canonical_type"):
            vr.error("provenance_fields", f"{loc}.provenance",
                     "canonical_type and canonical_id required")

    _validate_phases(vr, package, exam_id)

    vr.counts = {
        "exam": len(exam_records),
        "phases": len(rec.get("phases.jsonl", [])),
        "sections": len(rec["sections.jsonl"]),
        "layers": len(rec["layers.jsonl"]),
        "question_types": len(rec["question_types.jsonl"]),
        "units": len(rec["units.jsonl"]),
        "questions": len(rec["questions.jsonl"]),
        "answer_keys": len(rec["answer_keys.private.jsonl"]),
        "explanations": len(rec["explanations.jsonl"]),
        "assets": len(rec["assets.jsonl"]),
        "source_mappings": len(package.provenance),
    }
    return vr
