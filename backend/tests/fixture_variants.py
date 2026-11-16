"""Variants of the synthetic fixture package for M1.6 tests.

- cue_anomaly: audio material on the cloze unit whose cue timeline has a
  large gap (warning) and an overrun beyond the verified audio duration
  (blocking) — replicating the confirmed N4 cue-timeline problem pattern.
- tweak_prompt: changes one question's prompt so the package (and the unit
  input hash) land on a different content hash.
"""
import copy
import os
import tempfile
import uuid
from pathlib import Path

from importer_fixture import make_provenance, make_records, write_zip

EXAM = "JLPTGO-N5-TEST-EX"
CLOZE_UNIT = f"{EXAM}-ly-01-u01"
DQ_ASSET = f"{EXAM}-as002"


def make_variant_records(*, cue_anomaly: bool = False,
                         audio_duration_ms: int = 10_000,
                         tweak_prompt: bool = False) -> dict[str, list[dict]]:
    records = copy.deepcopy(make_records())

    if tweak_prompt:
        # Revise the cloze passage text: changes the cloze unit's input hash
        # (and the package content hash), invalidating review evidence bound
        # to the original unit content.
        unit = next(u for u in records["units.jsonl"] if u["id"] == CLOZE_UNIT)
        for child in unit["materials"][0]["content"]["blocks"][0]["children"]:
            if child.get("text") == "彼は":
                child["text"] = "彼は（改訂版）"

    if cue_anomaly:
        records["assets.jsonl"].append({
            "record_type": "media_asset", "schema_version": "2.0.0",
            "id": DQ_ASSET, "storage_key": "assets/test/dq.mp3",
            "mime_type": "audio/mpeg", "sha256": uuid.uuid4().hex * 2,
            "size_bytes": 2048, "duration_ms": audio_duration_ms,
            "availability": "verified",
        })
        unit = next(u for u in records["units.jsonl"] if u["id"] == CLOZE_UNIT)
        unit["materials"].append({
            "id": f"{CLOZE_UNIT}-m02", "kind": "audio", "role": "primary",
            "language": "ja-JP", "content": None, "asset_id": DQ_ASSET,
            # gap 16_000-5_000=11_000ms > 10s → cue_gap_large (warning);
            # end 17_000ms > verified audio 10_000ms → cue_over_duration (blocking)
            "cues": [
                {"index": 1, "start_ms": 0, "end_ms": 5_000, "text": {}},
                {"index": 2, "start_ms": 16_000, "end_ms": 17_000, "text": {}},
            ],
            "translated_from_material_id": None,
        })
    return records


def stage_variant(pg_engine, **kwargs) -> None:
    """Write the variant zip, stage it (new content hash, same package_id)."""
    from app.importer.reader import load_archive
    from app.importer.staging import stage_package

    records = make_variant_records(**kwargs)
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "variant.zip")
        write_zip(records, make_provenance(), path)
        stage_package(pg_engine, load_archive(Path(path))[0])
