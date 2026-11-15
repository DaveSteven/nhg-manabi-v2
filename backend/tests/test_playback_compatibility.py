"""Playback-compatibility validation for listening cue timelines (M1.5).

Pure data-level test over the Canonical packages in data/samples/Archive.zip
(user-local sample; skipped when absent). Verifies the cue data can drive:
seek-to-segment start, auto-pause at segment end, repeat/next segment,
AB-loop over one range, and full continuous playback — plus a regression
list of known cue-over-duration anomalies.
"""
import json
import os
import zipfile

import pytest

ARCHIVE = os.environ.get(
    "CANONICAL_ARCHIVE",
    os.path.join(os.path.dirname(__file__), "..", "..", "data", "samples", "Archive.zip"),
)

requires_archive = pytest.mark.skipif(
    not os.path.exists(ARCHIVE), reason="Canonical Archive.zip not present"
)

# Known cue-over-duration anomalies (M1.5 audit 2026-11-15): max cue end_ms
# beyond the verified unit-audio duration. Most are encoder-padding level
# (<100ms); N4/N5 listening tails reach several hundred ms. Any change to
# this list must be a conscious data decision, not a silently updated expect.
KNOWN_OVER_DURATION = {
    ("JLPTGO-N2-2018-12-r1", "JLPTGO-N2-2018-12-ly-16-u01"),
    ("JLPTGO-N2-2018-12-r1", "JLPTGO-N2-2018-12-ly-16-u03"),
    ("JLPTGO-N2-2018-12-r1", "JLPTGO-N2-2018-12-ly-16-u04"),
    ("JLPTGO-N2-2018-12-r1", "JLPTGO-N2-2018-12-ly-19-u03"),
    ("JLPTGO-N4-2018-07-r1", "JLPTGO-N4-2018-07-ly-12-u01"),
    ("JLPTGO-N4-2018-07-r1", "JLPTGO-N4-2018-07-ly-12-u03"),
    ("JLPTGO-N4-2018-07-r1", "JLPTGO-N4-2018-07-ly-12-u04"),
    ("JLPTGO-N4-2018-07-r1", "JLPTGO-N4-2018-07-ly-12-u05"),
    ("JLPTGO-N4-2018-07-r1", "JLPTGO-N4-2018-07-ly-12-u06"),
    ("JLPTGO-N4-2018-07-r1", "JLPTGO-N4-2018-07-ly-12-u08"),
    ("JLPTGO-N4-2018-07-r1", "JLPTGO-N4-2018-07-ly-13-u04"),
    ("JLPTGO-N4-2018-07-r1", "JLPTGO-N4-2018-07-ly-13-u07"),
    ("JLPTGO-N4-2018-07-r1", "JLPTGO-N4-2018-07-ly-14-u01"),
    ("JLPTGO-N4-2018-07-r1", "JLPTGO-N4-2018-07-ly-15-u01"),
    ("JLPTGO-N4-2018-07-r1", "JLPTGO-N4-2018-07-ly-15-u04"),
    ("JLPTGO-N4-2018-07-r1", "JLPTGO-N4-2018-07-ly-15-u05"),
    ("JLPTGO-N5-2018-07-r1", "JLPTGO-N5-2018-07-ly-12-u06"),
    ("JLPTGO-N5-2018-07-r1", "JLPTGO-N5-2018-07-ly-13-u05"),
    ("JLPTGO-N5-2018-07-r1", "JLPTGO-N5-2018-07-ly-14-u02"),
    ("JLPTGO-N5-2018-07-r1", "JLPTGO-N5-2018-07-ly-14-u04"),
    ("JLPTGO-N5-2018-07-r1", "JLPTGO-N5-2018-07-ly-14-u05"),
}


@pytest.fixture(scope="module")
def packages():
    with zipfile.ZipFile(ARCHIVE) as z:
        prefixes = sorted({p.rsplit("/", 1)[0] + "/" for p in z.namelist()
                           if p.endswith("manifest.json")})
        out = []
        for prefix in prefixes:
            def jsonl(name):
                return [json.loads(l) for l in z.read(prefix + name).decode().splitlines()
                        if l.strip()]
            out.append({
                "package": prefix.rstrip("/"),
                "units": jsonl("units.jsonl"),
                "assets": {a["id"]: a for a in jsonl("assets.jsonl")},
            })
        return out


def _cue_text(cue) -> str:
    return "".join(c.get("text", "") for c in cue.get("children", [])
                   if c.get("type") == "text")


@requires_archive
def test_cue_timelines_support_segment_playback(packages):
    checked_units = 0
    for pkg in packages:
        for unit in pkg["units"]:
            cue_mats = [m for m in unit.get("materials", []) if m.get("cues")]
            if not cue_mats:
                continue
            checked_units += 1
            for mat in cue_mats:
                cues = mat["cues"]
                assert [c["index"] for c in cues] == list(range(1, len(cues) + 1)), \
                    f"{unit['id']}: cue order/index must be contiguous"

                timed = [c for c in cues
                         if isinstance(c.get("start_ms"), int)
                         and isinstance(c.get("end_ms"), int)]
                # Seek + auto-pause: every timed segment has a valid [start,end).
                for c in timed:
                    assert 0 <= c["start_ms"] < c["end_ms"], f"{unit['id']} cue {c['index']}"
                    assert _cue_text(c) or c.get("children"), f"{unit['id']} cue {c['index']} has no text"
                # Sequential playback: no overlap, monotonic order.
                for a, b in zip(timed, timed[1:]):
                    assert b["start_ms"] >= a["end_ms"], \
                        f"{unit['id']}: cue {b['index']} overlaps {a['index']}"
                # AB-loop: any timed range is a valid loop pair (start<end).
                if timed:
                    loop_pair = (timed[0]["start_ms"], timed[0]["end_ms"])
                    assert loop_pair[0] < loop_pair[1]
                    # Full continuous playback bounds exist.
                    assert timed[0]["start_ms"] == min(c["start_ms"] for c in timed)
                    assert timed[-1]["end_ms"] == max(c["end_ms"] for c in timed)
    assert checked_units == 143, f"expected 143 cue-bearing units, got {checked_units}"


@requires_archive
def test_timeline_relative_to_unit_audio_and_overrun_list(packages):
    overruns = set()
    for pkg in packages:
        for unit in pkg["units"]:
            cue_mats = [m for m in unit.get("materials", []) if m.get("cues")]
            if not cue_mats:
                continue
            audio = [m for m in unit["materials"] if m.get("kind") == "audio"]
            assert len(audio) == 1 and audio[0].get("asset_id"), \
                f"{unit['id']}: cue material requires exactly one audio material"
            asset = pkg["assets"][audio[0]["asset_id"]]
            # Timeline is relative to the unit's own audio asset: verified
            # durations in the sample all bracket the cue timeline (modulo
            # the known overrun list below).
            if asset.get("availability") != "verified" or not asset.get("duration_ms"):
                continue
            ends = [c["end_ms"] for m in cue_mats for c in m["cues"]
                    if isinstance(c.get("end_ms"), int)]
            if ends and max(ends) > asset["duration_ms"]:
                overruns.add((pkg["package"], unit["id"]))
    assert overruns == KNOWN_OVER_DURATION, (
        "cue-over-duration set changed; review before updating: "
        f"new={sorted(overruns - KNOWN_OVER_DURATION)} "
        f"resolved={sorted(KNOWN_OVER_DURATION - overruns)}"
    )
