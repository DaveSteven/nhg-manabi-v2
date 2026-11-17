"""Publish transaction: staged Canonical package → immutable release snapshot.

Red lines implemented here:
- Reads ONLY staging (import_jobs/import_records). Writes registries
  (exam_catalogs, question_registry, media_assets), the release snapshot
  tables, and a publication_decisions audit row — nothing else.
- A fresh publish creates the snapshot in state='draft' (internal only).
  Promoting to 'published' (and switching exam_current_releases) is gated on
  review state: human_reviewed answer keys, complete units, verified media.
  Unreviewed content is refused — unreviewed question banks must not go
  public.
- Idempotent: publishing identical (exam_id, content_hash) returns the
  existing release instead of creating a second snapshot.
- One transaction per release; any failure rolls back completely.
"""
import json
import uuid

from sqlalchemy import text
from sqlalchemy.engine import Engine

from app.importer.errors import ImportError_ as CanonicalImportError
from app.importer.reader import CanonicalPackage
from app.importer.validator import validate_package

RECORD_TYPE_TO_FILE = {
    "exam": "exam.json",
    "section": "sections.jsonl",
    "layer": "layers.jsonl",
    "question_type": "question_types.jsonl",
    "unit": "units.jsonl",
    "question": "questions.jsonl",
    "answer_key": "answer_keys.private.jsonl",
    "explanation": "explanations.jsonl",
    "media_asset": "assets.jsonl",
    "exam_phase": "phases.jsonl",
}


class PublishError(CanonicalImportError):
    """Publish refused or failed."""


class PublishGateError(PublishError):
    """Content review gate not satisfied; release stays internal."""


def _load_staged_package(engine: Engine, package_id: str,
                         content_hash: str | None = None) -> tuple[str, CanonicalPackage]:
    """Rebuild a CanonicalPackage from staging rows for (package_id[, hash])."""
    with engine.connect() as conn:
        if content_hash:
            job = conn.execute(text(
                "SELECT id, content_hash FROM import_jobs"
                " WHERE package_id = :p AND content_hash = :h"),
                {"p": package_id, "h": content_hash}).first()
        else:
            job = conn.execute(text(
                "SELECT id, content_hash FROM import_jobs"
                " WHERE package_id = :p ORDER BY created_at DESC LIMIT 1"),
                {"p": package_id}).first()
        if job is None:
            raise PublishError(f"no staged job for package_id={package_id!r}")
        rows = conn.execute(text(
            "SELECT record_type, payload FROM import_records WHERE job_id = :j"),
            {"j": job.id}).fetchall()

    records: dict[str, list[dict]] = {f: [] for f in RECORD_TYPE_TO_FILE.values()}
    for row in rows:
        filename = RECORD_TYPE_TO_FILE.get(row.record_type)
        if filename is None:
            raise PublishError(f"unexpected record_type {row.record_type!r} in staging")
        records[filename].append(row.payload)

    package = CanonicalPackage(package_id=package_id, manifest={"schema_version": "2.0.0"},
                               records=records, provenance=[],
                               source_archive_sha256="")
    return str(job.content_hash), package


def _check_asset(engine: Engine, conn, asset: dict) -> None:
    """media_assets rows are shared across releases; refuse silent overwrite."""
    existing = conn.execute(text(
        "SELECT sha256 FROM media_assets WHERE id = :id"), {"id": asset["id"]}).first()
    if existing is not None and existing.sha256 != asset["sha256"]:
        raise PublishError(
            f"media asset {asset['id']} exists with different sha256")


def confirm_rights(engine: Engine, exam_id: str, reviewer_id: str,
                   notes: str | None = None) -> dict:
    """Record an independent content-licensing confirmation decision."""
    import uuid as _uuid
    with engine.begin() as conn:
        exists = conn.execute(text(
            "SELECT 1 FROM exam_catalogs WHERE id = :e"), {"e": exam_id}).first()
        if exists is None:
            raise PublishError(f"exam {exam_id!r} not in catalog")
        conn.execute(text(
            "INSERT INTO publication_decisions (id, exam_id,"
            " candidate_content_hash, decision, reviewer_id, notes)"
            " VALUES (:id, :e, '*', 'rights_confirmed', :reviewer, :notes)"),
            {"id": _uuid.uuid4(), "e": exam_id, "reviewer": reviewer_id,
             "notes": notes})
    return {"ok": True, "exam_id": exam_id, "decision": "rights_confirmed"}


def _insert_phases(conn, release_id, package: CanonicalPackage) -> None:
    """Strict-mock Phases (ADR-0019) — snapshot rows, absent for packages
    without `phases.jsonl` (those releases simply offer no mock)."""
    for ph in package.records.get("phases.jsonl", []):
        conn.execute(text(
            "INSERT INTO release_exam_phases (release_id, phase_id, position,"
            " title, duration_seconds, playback_policy)"
            " VALUES (:r, :pid, :pos, :title, :dur, CAST(:pol AS jsonb))"),
            {"r": release_id, "pid": ph["id"], "pos": ph["position"],
             "title": ph["title"], "dur": ph["duration_seconds"],
             "pol": json.dumps(ph["playback_policy"], ensure_ascii=False)
             if ph.get("playback_policy") is not None else None})


def _insert_phase_units(conn, release_id, package: CanonicalPackage) -> None:
    """Assign every Unit to the one Phase owning its section subject, in
    exam order (section → layer → unit position). Validation guarantees full
    coverage; this runs after release_units exist (composite FK)."""
    phases = package.records.get("phases.jsonl", [])
    if not phases:
        return
    rec = package.records
    phase_by_subject = {s: ph["id"] for ph in phases for s in ph["subjects"]}
    section_pos = {s["subject"]: s["position"] for s in rec["sections.jsonl"]}
    layer = {l["id"]: l for l in rec["layers.jsonl"]}

    def order(u):
        ly = layer[u["layer_id"]]
        return (section_pos[ly["section"]], ly["position"], u["position"])

    counters: dict[str, int] = {}
    for u in sorted(rec["units.jsonl"], key=order):
        pid = phase_by_subject[layer[u["layer_id"]]["section"]]
        counters[pid] = counters.get(pid, 0) + 1
        conn.execute(text(
            "INSERT INTO release_phase_units (release_id, phase_id, unit_id,"
            " position) VALUES (:r, :pid, :uid, :pos)"),
            {"r": release_id, "pid": pid, "uid": u["id"], "pos": counters[pid]})


def publish_package(engine: Engine, package_id: str,
                    content_hash: str | None = None,
                    reviewer_id: str | None = None,
                    notes: str | None = None) -> dict:
    """Create (or return) the immutable draft release snapshot for a package."""
    content_hash, package = _load_staged_package(engine, package_id, content_hash)

    with engine.connect() as conn:
        existing = conn.execute(text(
            "SELECT id, state, revision FROM exam_releases"
            " WHERE exam_id = :e AND content_hash = :h"),
            {"e": package.records["exam.json"][0]["id"], "h": content_hash}).first()
    if existing is not None:
        return {"release_id": str(existing.id), "state": existing.state,
                "revision": existing.revision, "idempotent": True}

    vr = validate_package(package)
    if vr.errors:
        from app.importer.errors import ValidationError
        raise ValidationError([i.as_dict() for i in vr.errors])

    exam = package.records["exam.json"][0]
    exam_id = exam["id"]
    release_id = uuid.uuid4()

    # Answer-key review evidence is bound to the per-unit input hash; compute
    # it once for this staged content (same function the Agent sync binds to).
    from app.review_sync import _build_input_for
    unit_input_hash_by_question = {}
    for u in package.records["units.jsonl"]:
        unit_hash = _build_input_for(package, u["id"])["content_hash"]
        for q in package.records["questions.jsonl"]:
            if q["unit_id"] == u["id"]:
                unit_input_hash_by_question[q["id"]] = unit_hash

    with engine.begin() as conn:
        next_rev = conn.execute(text(
            "SELECT COALESCE(MAX(revision), 0) + 1 FROM exam_releases"
            " WHERE exam_id = :e"), {"e": exam_id}).scalar()

        conn.execute(text(
            "INSERT INTO exam_catalogs (id, level, year, month, kind, title)"
            " VALUES (:id, :level, :year, :month, :kind, :title)"
            " ON CONFLICT (id) DO NOTHING"),
            {"id": exam_id, "level": exam["level"], "year": exam["year"],
             "month": exam["month"], "kind": exam["kind"], "title": exam["title"]})

        for q in package.records["questions.jsonl"]:
            conn.execute(text(
                "INSERT INTO question_registry (id, exam_id)"
                " VALUES (:id, :e) ON CONFLICT (id) DO NOTHING"),
                {"id": q["id"], "e": exam_id})

        for asset in package.records["assets.jsonl"]:
            _check_asset(engine, conn, asset)
            conn.execute(text(
                "INSERT INTO media_assets (id, sha256, storage_key, mime_type,"
                " size_bytes, duration_ms, availability)"
                " VALUES (:id, :sha, :key, :mime, :size, :dur, :avail)"
                " ON CONFLICT (id) DO NOTHING"),
                {"id": asset["id"], "sha": asset["sha256"],
                 "key": asset["storage_key"], "mime": asset["mime_type"],
                 "size": asset.get("size_bytes"), "dur": asset.get("duration_ms"),
                 "avail": asset.get("availability", "unchecked")})

        conn.execute(text(
            "INSERT INTO exam_releases (id, exam_id, revision, content_hash,"
            " schema_version, state) VALUES (:id, :e, :rev, :h, :sv, 'draft')"),
            {"id": release_id, "e": exam_id, "rev": next_rev, "h": content_hash,
             "sv": "2.0.0"})

        # Semantic question-type dictionary (stable across packages).
        for qt in package.records["question_types.jsonl"]:
            conn.execute(text(
                "INSERT INTO question_types (id, subject, label_zh, label_ja,"
                " answer_mode, default_unit_kind, is_provisional)"
                " VALUES (:id, :subject, :lzh, :lja, :mode, :duk, :prov)"
                " ON CONFLICT (id) DO NOTHING"),
                {"id": qt["id"], "subject": qt["subject"],
                 "lzh": qt["label_zh"], "lja": qt["label_ja"],
                 "mode": qt["answer_mode"], "duk": qt.get("default_unit_kind"),
                 "prov": bool(qt.get("_provisional", False))})

        for s in package.records["sections.jsonl"]:
            conn.execute(text(
                "INSERT INTO release_sections (release_id, section_id, subject,"
                " position, title) VALUES (:r, :sid, :subject, :pos, :title)"),
                {"r": release_id, "sid": s["id"], "subject": s["subject"],
                 "pos": s["position"], "title": s["title"]})

        # Canonical layers reference sections by (exam_id, subject); the
        # snapshot table needs the stable section_id — map here.
        section_id_by_subject = {s["subject"]: s["id"]
                                 for s in package.records["sections.jsonl"]}
        for l in package.records["layers.jsonl"]:
            conn.execute(text(
                "INSERT INTO release_layers (release_id, layer_id, section_id,"
                " question_type_id, position, display_label, instruction)"
                " VALUES (:r, :lid, :sid, :qt, :pos, :label,"
                " CAST(:instr AS jsonb))"),
                {"r": release_id, "lid": l["id"],
                 "sid": section_id_by_subject[l["section"]],
                 "qt": l["question_type_id"], "pos": l["position"],
                 "label": l.get("display_label"),
                 "instr": json.dumps(l.get("instruction"), ensure_ascii=False)
                 if l.get("instruction") is not None else None})

        _insert_phases(conn, release_id, package)

        for u in package.records["units.jsonl"]:
            conn.execute(text(
                "INSERT INTO release_units (release_id, unit_id, layer_id,"
                " question_type_id, kind, position, label, slot_ids,"
                " conversion_status)"
                " VALUES (:r, :uid, :lid, :qt, :kind, :pos, :label,"
                " CAST(:slots AS jsonb), :status)"),
                {"r": release_id, "uid": u["id"], "lid": u["layer_id"],
                 "qt": u["question_type_id"], "kind": u["kind"],
                 "pos": u["position"], "label": u.get("label"),
                 "slots": json.dumps(u.get("slot_ids", []), ensure_ascii=False),
                 "status": u.get("conversion_status", "complete")})
            for pos, m in enumerate(u.get("materials", []), start=1):
                conn.execute(text(
                    "INSERT INTO release_unit_materials (release_id,"
                    " material_id, unit_id, position, kind, role, language,"
                    " content, cues, asset_id, translated_from_material_id)"
                    " VALUES (:r, :mid, :uid, :pos, :kind, :role, :lang,"
                    " CAST(:content AS jsonb), CAST(:cues AS jsonb), :asset,"
                    " :tfm)"),
                    {"r": release_id, "mid": m["id"], "uid": u["id"],
                     "pos": pos, "kind": m["kind"], "role": m.get("role"),
                     "lang": m.get("language"),
                     "content": json.dumps(m["content"], ensure_ascii=False)
                     if m.get("content") is not None else None,
                     "cues": json.dumps(m["cues"], ensure_ascii=False)
                     if m.get("cues") is not None else None,
                     "asset": m.get("asset_id"),
                     "tfm": m.get("translated_from_material_id")})

        _insert_phase_units(conn, release_id, package)

        for q in package.records["questions.jsonl"]:
            conn.execute(text(
                "INSERT INTO release_questions (release_id, question_id,"
                " unit_id, question_type_id, position, printed_number, prompt,"
                " slot_id, conversion_status)"
                " VALUES (:r, :qid, :uid, :qt, :pos, :pn,"
                " CAST(:prompt AS jsonb), :slot, :status)"),
                {"r": release_id, "qid": q["id"], "uid": q["unit_id"],
                 "qt": q["question_type_id"], "pos": q["position"],
                 "pn": q.get("printed_number"),
                 "prompt": json.dumps(q["prompt"], ensure_ascii=False)
                 if q.get("prompt") is not None else None,
                 "slot": q.get("slot_id"),
                 "status": q.get("conversion_status", "complete")})
            for o in q["options"]:
                conn.execute(text(
                    "INSERT INTO release_options (release_id, option_id,"
                    " question_id, position, content)"
                    " VALUES (:r, :oid, :qid, :pos, CAST(:content AS jsonb))"),
                    {"r": release_id, "oid": o["id"], "qid": q["id"],
                     "pos": o["position"],
                     "content": json.dumps(o["content"], ensure_ascii=False)})
                for aid in o.get("media_asset_ids", []) or []:
                    conn.execute(text(
                        "INSERT INTO release_option_media (release_id,"
                        " option_id, asset_id, role)"
                        " VALUES (:r, :oid, :aid, 'illustration')"),
                        {"r": release_id, "oid": o["id"], "aid": aid})
            for aid in q.get("media_asset_ids", []) or []:
                conn.execute(text(
                    "INSERT INTO release_question_media (release_id,"
                    " question_id, asset_id, role)"
                    " VALUES (:r, :qid, :aid, 'illustration')"),
                    {"r": release_id, "qid": q["id"], "aid": aid})

        for ak in package.records["answer_keys.private.jsonl"]:
            # Review status authority is content_reviews (hash-bound evidence,
            # latest by insertion sequence); staged payload status is only the
            # initial default. Evidence from OTHER content hashes never
            # satisfies this candidate: each question's verdict must be bound
            # to the unit-input hash of THIS staged content.
            reviewed = conn.execute(text(
                "SELECT review_status FROM content_reviews"
                " WHERE record_type = 'answer_key' AND canonical_id = :cid"
                " AND content_hash = :chash"
                " AND reviewer_type IN ('agent','human')"
                " ORDER BY sequence DESC LIMIT 1"),
                {"cid": ak["question_id"],
                 "chash": unit_input_hash_by_question[ak["question_id"]]}).scalar()
            conn.execute(text(
                "INSERT INTO release_answer_keys (release_id, question_id,"
                " correct_option_id, revision, review_status)"
                " VALUES (:r, :qid, :oid, :rev, :status)"),
                {"r": release_id, "qid": ak["question_id"],
                 "oid": ak["correct_option_ids"][0], "rev": ak["revision"],
                 "status": reviewed or ak["review_status"]})

        for e in package.records["explanations.jsonl"]:
            conn.execute(text(
                "INSERT INTO release_explanations (release_id, explanation_id,"
                " question_id, unit_id, kind, language, content, revision,"
                " review_status)"
                " VALUES (:r, :eid, :qid, :uid, :kind, :lang,"
                " CAST(:content AS jsonb), :rev, :status)"),
                {"r": release_id, "eid": e["id"],
                 "qid": e["owner_id"] if e["owner_type"] == "question" else None,
                 "uid": e["owner_id"] if e["owner_type"] == "unit" else None,
                 "kind": e["kind"], "lang": e["language"],
                 "content": json.dumps(e["content"], ensure_ascii=False),
                 "rev": e["revision"], "status": e["review_status"]})

        full_audio = exam.get("full_audio_asset_id")
        if full_audio:
            conn.execute(text(
                "INSERT INTO release_exam_media (release_id, asset_id, role)"
                " VALUES (:r, :aid, 'full_audio')"),
                {"r": release_id, "aid": full_audio})

        conn.execute(text(
            "INSERT INTO publication_decisions (id, exam_id,"
            " candidate_content_hash, decision, reviewer_id, notes)"
            " VALUES (:id, :e, :h, :decision, :reviewer, :notes)"),
            {"id": uuid.uuid4(), "e": exam_id, "h": content_hash,
             "decision": "snapshot_draft_created",
             "reviewer": reviewer_id, "notes": notes})

    return {"release_id": str(release_id), "state": "draft",
            "revision": next_rev, "idempotent": False}


class ReleaseStateError(PublishError):
    """A withdraw/restore request that the release's current state forbids."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def withdraw_release(engine: Engine, release_id: str, admin_reviewer_id: str,
                     reason: str | None = None) -> dict:
    """下架: a published release stops being served everywhere.

    Every public exit (catalog, outline, release units, media, new sessions)
    already requires state='published', so flipping the state and clearing
    the current pointer closes them all. Snapshot rows and students' own
    study records are untouched, and the action is reversible
    (``restore_release``). The decision is recorded, never overwritten.
    """
    with engine.begin() as conn:
        row = conn.execute(text(
            "SELECT id, exam_id, content_hash, state FROM exam_releases"
            " WHERE id = :r FOR UPDATE"), {"r": release_id}).first()
        if row is None:
            raise ReleaseStateError("not_found", f"release {release_id} not found")
        if row.state != "published":
            raise ReleaseStateError(
                "not_published", f"release is {row.state}, only published releases can be withdrawn")
        conn.execute(text("UPDATE exam_releases SET state = 'withdrawn' WHERE id = :r"),
                     {"r": release_id})
        conn.execute(text(
            "DELETE FROM exam_current_releases WHERE exam_id = :e AND release_id = :r"),
            {"e": row.exam_id, "r": release_id})
        conn.execute(text(
            "INSERT INTO publication_decisions (id, exam_id, candidate_content_hash,"
            " decision, reviewer_id, notes) VALUES (:id, :e, :h, 'withdrawn', :who, :n)"),
            {"id": uuid.uuid4(), "e": row.exam_id, "h": row.content_hash,
             "who": admin_reviewer_id, "n": reason})
    return {"release_id": str(release_id), "exam_id": row.exam_id, "state": "withdrawn"}


def restore_release(engine: Engine, release_id: str, admin_reviewer_id: str) -> dict:
    """上架: undo a withdrawal. Refuses when the exam already has a current
    release (restoring must never silently displace a newer one)."""
    with engine.begin() as conn:
        row = conn.execute(text(
            "SELECT id, exam_id, content_hash, state FROM exam_releases"
            " WHERE id = :r FOR UPDATE"), {"r": release_id}).first()
        if row is None:
            raise ReleaseStateError("not_found", f"release {release_id} not found")
        if row.state != "withdrawn":
            raise ReleaseStateError(
                "not_withdrawn", f"release is {row.state}, only withdrawn releases can be restored")
        current = conn.execute(text(
            "SELECT release_id FROM exam_current_releases WHERE exam_id = :e"),
            {"e": row.exam_id}).first()
        if current is not None:
            raise ReleaseStateError(
                "exam_has_current_release",
                "this exam already has a current release; withdraw it first")
        conn.execute(text("UPDATE exam_releases SET state = 'published' WHERE id = :r"),
                     {"r": release_id})
        conn.execute(text(
            "INSERT INTO exam_current_releases (exam_id, release_id, changed_at)"
            " VALUES (:e, :r, now())"), {"e": row.exam_id, "r": release_id})
        conn.execute(text(
            "INSERT INTO publication_decisions (id, exam_id, candidate_content_hash,"
            " decision, reviewer_id, notes) VALUES (:id, :e, :h, 'restored', :who, NULL)"),
            {"id": uuid.uuid4(), "e": row.exam_id, "h": row.content_hash,
             "who": admin_reviewer_id})
    return {"release_id": str(release_id), "exam_id": row.exam_id, "state": "published"}


def auto_publish_package(engine: Engine, package_id: str,
                         reviewer_id: str = "system:auto-publish") -> dict:
    """ADR-0010 policy 'auto': create the release snapshot and publish it
    WITHOUT the review / rights / media gates.

    Nothing is relabelled as verified: answer-key and unit statuses stay as
    they are. The ``auto_published`` decision stores a JSON note listing what
    was NOT verified, so the audit trail never implies review. Structural
    validation in the importer/publish_package still applies, and the public
    API still hides units that are not conversion-complete.
    """
    created = publish_package(engine, package_id, reviewer_id=reviewer_id)
    release_id = created["release_id"]
    with engine.begin() as conn:
        release = conn.execute(text(
            "SELECT id, exam_id, content_hash, state FROM exam_releases"
            " WHERE id = :r"), {"r": release_id}).first()
        if release.state == "published":
            return {"release_id": release_id, "state": "published",
                    "idempotent": True}
        if release.state == "withdrawn":
            raise PublishError("withdrawn releases cannot be auto-published; "
                               "create a new release")
        unverified = conn.execute(text(
            "SELECT count(*) FROM release_answer_keys WHERE release_id = :r"
            " AND review_status NOT IN ('agent_verified','human_reviewed')"),
            {"r": release_id}).scalar()
        incomplete = conn.execute(text(
            "SELECT count(*) FROM release_units WHERE release_id = :r"
            " AND conversion_status <> 'complete'"), {"r": release_id}).scalar()
        unchecked_media = conn.execute(text(
            "SELECT count(DISTINCT a.id) FROM release_unit_materials m"
            " JOIN media_assets a ON a.id = m.asset_id"
            " WHERE m.release_id = :r AND a.availability <> 'verified'"),
            {"r": release_id}).scalar()
        rights = conn.execute(text(
            "SELECT count(*) FROM publication_decisions WHERE exam_id = :e"
            " AND decision = 'rights_confirmed'"), {"e": release.exam_id}).scalar()
        note = json.dumps({
            "policy": "auto", "adr": "ADR-0010",
            "unverified_answer_keys": unverified,
            "units_not_conversion_complete": incomplete,
            "unverified_media_assets": unchecked_media,
            "rights_confirmed": bool(rights)}, ensure_ascii=False)
        conn.execute(text(
            "UPDATE exam_releases SET state = 'published',"
            " published_at = now() WHERE id = :r"), {"r": release_id})
        conn.execute(text(
            "INSERT INTO exam_current_releases (exam_id, release_id, changed_at)"
            " VALUES (:e, :r, now())"
            " ON CONFLICT (exam_id) DO UPDATE SET"
            " release_id = EXCLUDED.release_id, changed_at = now()"),
            {"e": release.exam_id, "r": release_id})
        conn.execute(text(
            "INSERT INTO publication_decisions (id, exam_id,"
            " candidate_content_hash, decision, reviewer_id, notes)"
            " VALUES (:id, :e, :h, 'auto_published', :reviewer, :notes)"),
            {"id": uuid.uuid4(), "e": release.exam_id,
             "h": release.content_hash, "reviewer": reviewer_id, "notes": note})
    return {"release_id": release_id, "state": "published", "idempotent": False}


def promote_release(engine: Engine, release_id: str, reviewer_id: str,
                    notes: str | None = None) -> dict:
    """Promote a draft release to published and switch the current pointer.

    Hard gates (lightweight review workflow): every answer key carries a
    valid 'agent_verified' (hash-bound Agent evidence) or 'human_reviewed'
    verdict; every unit conversion-complete AND not blocked by an open
    blocking issue or a needs_review/blocked Agent verdict on the current
    content hash (deterministic by review insertion sequence — a later
    Agent pass never auto-clears an open issue); no open blocking issue of
    any kind (incl. data-quality findings) on this content hash; media
    verified; an explicit rights confirmation decision recorded. Unreviewed
    or disputed content is refused — it must not go public.
    """
    from app.review_state import latest_review, open_issues
    from app.review_sync import UNIT_BLOCKING, _build_input_for

    with engine.begin() as conn:
        release = conn.execute(text(
            "SELECT id, exam_id, content_hash, state FROM exam_releases"
            " WHERE id = :r"), {"r": release_id}).first()
        if release is None:
            raise PublishError(f"release {release_id} not found")
        if release.state == "published":
            return {"release_id": release_id, "state": "published",
                    "idempotent": True}
        if release.state == "withdrawn":
            raise PublishError("withdrawn releases cannot be re-published; "
                               "create a new release")

        bad_keys = conn.execute(text(
            "SELECT count(*) FROM release_answer_keys"
            " WHERE release_id = :r AND review_status NOT IN"
            " ('agent_verified','human_reviewed')"),
            {"r": release_id}).scalar()
        if bad_keys:
            raise PublishGateError(
                f"{bad_keys} answer key(s) lack a valid 'agent_verified' or "
                "'human_reviewed' verdict on this content hash; publishing refused")

        bad_units = conn.execute(text(
            "SELECT count(*) FROM release_units"
            " WHERE release_id = :r AND conversion_status <> 'complete'"),
            {"r": release_id}).scalar()
        if bad_units:
            raise PublishGateError(
                f"{bad_units} unit(s) not conversion-complete (e.g. heuristic "
                "A/B splits); publishing refused")

        # Agent-flagged units on the current content hash block publishing.
        # Latest verdict by insertion sequence; open blocking issues dominate
        # regardless of any later Agent pass (pass never auto-clears).
        staged_job = conn.execute(text(
            "SELECT package_id FROM import_jobs WHERE content_hash = :h"
            " ORDER BY created_at DESC LIMIT 1"), {"h": release.content_hash}).first()
        if staged_job is not None:
            _, staged_pkg = _load_staged_package(engine, staged_job.package_id,
                                                 release.content_hash)
            flagged = []
            for u in staged_pkg.records["units.jsonl"]:
                unit_input = _build_input_for(staged_pkg, u["id"])
                unit_issues = open_issues(conn, "unit", u["id"],
                                          unit_input["content_hash"],
                                          severity="blocking")
                if unit_issues:
                    flagged.append({"unit_id": u["id"],
                                    "reason": "open_issue",
                                    "issues": [str(i.id) for i in unit_issues]})
                    continue
                # A later explicit human confirmation (resolve_issue) of the
                # unit supersedes the Agent's flag; open issues were already
                # handled above and still dominate.
                latest_any = latest_review(conn, "unit", u["id"],
                                           unit_input["content_hash"])
                if (latest_any is not None
                        and latest_any.reviewer_type == "human"
                        and latest_any.review_status == "human_reviewed"):
                    continue
                unit_review = latest_review(conn, "unit", u["id"],
                                            unit_input["content_hash"],
                                            reviewer_type="agent")
                if unit_review is not None and unit_review.review_status in UNIT_BLOCKING:
                    flagged.append({"unit_id": u["id"],
                                    "status": unit_review.review_status})
            if flagged:
                raise PublishGateError(
                    f"{len(flagged)} unit(s) flagged needs_review/blocked by "
                    f"Agent review: {flagged}; publishing refused")

        # Open blocking issues bound to this release's content hash (data-
        # quality findings and any other structural/media anomalies) refuse
        # promotion; warnings do not block but stay on record.
        open_blocking = conn.execute(text(
            "SELECT issue_code, canonical_id FROM content_issues"
            " WHERE status = 'open' AND severity = 'blocking'"
            " AND content_hash = :h LIMIT 20"),
            {"h": release.content_hash}).fetchall()
        if open_blocking:
            raise PublishGateError(
                f"{len(open_blocking)} unresolved blocking issue(s) on this "
                f"content hash: "
                f"{[{'code': r.issue_code, 'id': r.canonical_id} for r in open_blocking]}; "
                "publishing refused")

        bad_media = conn.execute(text(
            "SELECT count(*) FROM release_units u"
            " JOIN release_unit_materials m"
            " ON m.release_id = u.release_id AND m.unit_id = u.unit_id"
            " JOIN media_assets a ON a.id = m.asset_id"
            " WHERE u.release_id = :r AND a.availability <> 'verified'"),
            {"r": release_id}).scalar()
        if bad_media:
            raise PublishGateError(
                f"{bad_media} media asset reference(s) not verified; "
                "publishing refused")

        rights = conn.execute(text(
            "SELECT count(*) FROM publication_decisions"
            " WHERE exam_id = :e AND decision = 'rights_confirmed'"),
            {"e": release.exam_id}).scalar()
        if not rights:
            raise PublishGateError(
                "no 'rights_confirmed' publication decision for this exam; "
                "content licensing must be confirmed independently")

        conn.execute(text(
            "UPDATE exam_releases SET state = 'published',"
            " published_at = now() WHERE id = :r"), {"r": release_id})
        conn.execute(text(
            "INSERT INTO exam_current_releases (exam_id, release_id, changed_at)"
            " VALUES (:e, :r, now())"
            " ON CONFLICT (exam_id) DO UPDATE SET"
            " release_id = EXCLUDED.release_id, changed_at = now()"),
            {"e": release.exam_id, "r": release_id})
        conn.execute(text(
            "INSERT INTO publication_decisions (id, exam_id,"
            " candidate_content_hash, decision, reviewer_id, notes)"
            " VALUES (:id, :e, :h, 'approved', :reviewer, :notes)"),
            {"id": uuid.uuid4(), "e": release.exam_id,
             "h": release.content_hash, "reviewer": reviewer_id, "notes": notes})

    return {"release_id": release_id, "state": "published", "idempotent": False}
