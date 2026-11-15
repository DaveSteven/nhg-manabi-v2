"""Validate checksums and aggregated counts inside a Canonical sample archive.

This does NOT check answer correctness or actual media bytes. No DB writes.
Usage: python scripts/verify_canonical_archive.py /path/to/Archive.zip
"""
import hashlib
import json
import sys
import zipfile
from collections import Counter
from pathlib import Path


def verify_archive(path: Path) -> dict[str, int]:
    totals = Counter()
    seen = []
    with zipfile.ZipFile(path) as z:
        prefixes = sorted({p.rsplit("/", 1)[0] + "/" for p in z.namelist() if p.endswith("/manifest.json")})
        if not prefixes:
            raise ValueError("No Canonical manifest.json found")
        for prefix in prefixes:
            manifest = json.loads(z.read(prefix + "manifest.json"))
            if manifest.get("schema_version") != "2.0.0":
                raise ValueError(f"Unsupported schema: {prefix}")
            for item in manifest.get("files", []):
                entry = prefix + item["path"]
                raw = z.read(entry)
                if len(raw) != item["bytes"] or hashlib.sha256(raw).hexdigest() != item["sha256"]:
                    raise ValueError(f"Checksum mismatch: {entry}")
            counts = manifest["counts"]
            # Assert actual JSONL rows, not just manifest-reported totals.
            for label, file in [("sections", "sections.jsonl"), ("layers", "layers.jsonl"),
                                ("units", "units.jsonl"), ("questions", "questions.jsonl"),
                                ("assets", "assets.jsonl")]:
                actual = sum(bool(line.strip()) for line in z.read(prefix + file).splitlines())
                if actual != counts[label]:
                    raise ValueError(f"Count mismatch: {prefix + file}: {actual}!={counts[label]}")
                totals[label] += actual
            seen.append(prefix.rstrip("/"))
    print(f"Verified {len(seen)} Canonical packages: {', '.join(seen)}")
    print("Totals:", dict(totals))
    return dict(totals)


if __name__ == "__main__":
    verify_archive(Path(sys.argv[1]))
