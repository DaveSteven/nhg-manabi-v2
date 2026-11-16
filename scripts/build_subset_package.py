"""Build a SUBSET Canonical package from a validated one (drops whole subjects).

Used to release the verified part of an exam while other parts (e.g.
listening, not yet verified) wait for a later full release. Nothing is
edited: records are only filtered, so every kept Unit keeps its exact
content (=> its review evidence, bound to the unit input hash, still
applies). The result is a NEW package id (=> new content hash => new
release); the source package and any existing release are untouched.

    python scripts/build_subset_package.py <src-pkg-dir> <dst-pkg-dir> \
        --package-id JLPTGO-N2-2018-12-r2 --exclude-subject listening \
        [--exclude-unit <unit-id>]
"""
import argparse
import hashlib
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path


def read_jsonl(p: Path) -> list[dict]:
    return [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()]


def jsonl_bytes(rows: list[dict]) -> bytes:
    return ("\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n").encode("utf-8")


def asset_refs(obj, acc: set) -> None:
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k == "asset_id" and isinstance(v, str):
                acc.add(v)
            elif k == "media_asset_ids" and isinstance(v, list):
                acc.update(x for x in v if isinstance(x, str))
            else:
                asset_refs(v, acc)
    elif isinstance(obj, list):
        for v in obj:
            asset_refs(v, acc)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("src"); ap.add_argument("dst")
    ap.add_argument("--package-id", required=True)
    ap.add_argument("--exclude-subject", action="append", default=[])
    ap.add_argument("--exclude-unit", action="append", default=[],
                    help="drop one Unit id (e.g. conversion_status needs_review)")
    a = ap.parse_args()
    src, dst = Path(a.src), Path(a.dst)
    if dst.exists():
        raise SystemExit(f"{dst} exists; refusing to overwrite")
    excl = set(a.exclude_subject)

    manifest = json.loads((src / "manifest.json").read_text())
    exam = json.loads((src / "exam.json").read_text())
    sections = [s for s in read_jsonl(src / "sections.jsonl") if s["subject"] not in excl]
    layers = [l for l in read_jsonl(src / "layers.jsonl") if l["section"] not in excl]
    layer_ids = {l["id"] for l in layers}
    if not excl and not a.exclude_unit:
        raise SystemExit("nothing to exclude")
    units = [u for u in read_jsonl(src / "units.jsonl")
             if u["layer_id"] in layer_ids and u["id"] not in set(a.exclude_unit)]
    used_layers = {u["layer_id"] for u in units}
    layers = [l for l in layers if l["id"] in used_layers]  # no empty layers
    layer_ids = {l["id"] for l in layers}
    unit_ids = {u["id"] for u in units}
    questions = [q for q in read_jsonl(src / "questions.jsonl") if q["unit_id"] in unit_ids]
    qids = {q["id"] for q in questions}
    keys = [k for k in read_jsonl(src / "answer_keys.private.jsonl") if k["question_id"] in qids]
    expl = [e for e in read_jsonl(src / "explanations.jsonl")
            if (e["owner_type"] == "unit" and e["owner_id"] in unit_ids)
            or (e["owner_type"] == "question" and e["owner_id"] in qids)]
    qtype_ids = {l["question_type_id"] for l in layers}
    qtypes = [t for t in read_jsonl(src / "question_types.jsonl") if t["id"] in qtype_ids]

    refs: set = set()
    for rows in (units, questions, layers):
        asset_refs(rows, refs)
    # The whole-exam audio belongs to the excluded listening part.
    exam["full_audio_asset_id"] = None
    assets = [x for x in read_jsonl(src / "assets.jsonl") if x["id"] in refs]
    kept_ids = unit_ids | qids | layer_ids
    prov = [p for p in read_jsonl(src / "provenance/source_refs.private.jsonl")
            if p.get("canonical_id") in kept_ids]

    files = {
        "exam.json": (json.dumps(exam, ensure_ascii=False, indent=2) + "\n").encode("utf-8"),
        "sections.jsonl": jsonl_bytes(sections),
        "question_types.jsonl": jsonl_bytes(qtypes),
        "layers.jsonl": jsonl_bytes(layers),
        "units.jsonl": jsonl_bytes(units),
        "questions.jsonl": jsonl_bytes(questions),
        "answer_keys.private.jsonl": jsonl_bytes(keys),
        "explanations.jsonl": jsonl_bytes(expl),
        "assets.jsonl": jsonl_bytes(assets),
        "provenance/source_refs.private.jsonl": jsonl_bytes(prov),
    }
    report = {"subset_of": manifest["package_id"], "excluded_subjects": sorted(excl), "excluded_units": sorted(a.exclude_unit),
              "generated_at": datetime.now(timezone.utc).isoformat(),
              "note": "records filtered only; no content edited",
              "counts": {"units": len(units), "questions": len(questions),
                         "assets": len(assets)}}
    files["reports/import_report.json"] = (json.dumps(report, ensure_ascii=False, indent=2) + "\n").encode("utf-8")

    dst.mkdir(parents=True)
    for rel, raw in files.items():
        (dst / rel).parent.mkdir(parents=True, exist_ok=True)
        (dst / rel).write_bytes(raw)
    new = {k: v for k, v in manifest.items() if k not in ("files", "counts")}
    new.update(package_id=a.package_id, generated_at=report["generated_at"],
               counts={"sections": len(sections), "layers": len(layers),
                       "units": len(units), "questions": len(questions),
                       "assets": len(assets), "explanations": len(expl)},
               files=[{"path": rel, "sha256": hashlib.sha256(raw).hexdigest(),
                       "bytes": len(raw)} for rel, raw in files.items()])
    (dst / "manifest.json").write_text(json.dumps(new, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(new["counts"]), "->", dst)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
