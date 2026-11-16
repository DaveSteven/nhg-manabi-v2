"""Controlled media storage sync — independent of the metadata importer.

Copies media binaries from confirmed LOCAL read-only sources into a
controlled v2 media directory and records a queryable per-asset mapping
(media_storage). Design red lines (user-confirmed 2026-11-16):

- Never downloads remote resources; only local, explicitly configured
  sources. Raw samples are read-only and never modified.
- asset_id stays the Canonical business identity; stored files are named
  by SHA-256 (content addressing, dedup by identical bytes):
  <root>/<sha[:2]>/<sha[2:4]>/<sha><ext>. Original filenames/paths live
  only in media_storage.source_path (internal, never public).
- Validate before writing: size, sniffed MIME, SHA-256 against the
  Canonical asset record, audio playability (ffprobe) + duration check.
  Write via temp file + atomic os.replace; re-running is idempotent and
  never breaks an already-validated stored file.
- Writes only media_storage rows. No published tables, no release
  snapshots, no staging rows. A stored file is NOT a review/publish
  approval; serving is gated separately by the media API.
- Failures mark the asset 'unavailable' with a JSONB diagnostic instead
  of pretending a playable resource exists.

Usage (CLI):
    python -m app.media_sync <package-dir-or-zip> \
        --source-root <raw-samples-dir> [--source-root ...] \
        [--storage-dir <dir>]

The package provides assets.jsonl (Canonical MediaAsset records). Source
roots are searched for Raw resources.json manifests; files are matched to
assets by recomputed SHA-256 (content addressing — no path assumptions).
"""
import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.engine import Engine

MEDIA_SYNC_VERSION = "media-sync+0.1.0"

_SHA_RE = re.compile(r"^[0-9a-f]{64}$")

# Storage filename extension per declared MIME (images follow the same
# sha256 naming standard as audio; only the extension differs).
_MIME_EXT = {
    "audio/mpeg": ".mp3",
    "image/png": ".png",
    "image/jpeg": ".jpg",
}

_DURATION_TOLERANCE_MS = 2000  # encoder padding allowance (M1.5: ≤1282ms seen)


def storage_ext(mime_type: str) -> str:
    return _MIME_EXT.get((mime_type or "").lower(), ".bin")


def storage_rel_path(sha256: str, mime_type: str) -> str:
    """Content-addressed shard path: ab/cd/<sha256>.<ext>."""
    return f"{sha256[:2]}/{sha256[2:4]}/{sha256}{storage_ext(mime_type)}"


@dataclass
class SourceFile:
    path: Path
    source_system: str
    source_path: str  # raw-relative provenance path, internal only
    declared_size: int | None
    declared_mime: str | None


@dataclass
class SyncIssue:
    asset_id: str
    reason: str
    detail: str

    def as_dict(self) -> dict:
        return {"asset_id": self.asset_id, "reason": self.reason,
                "detail": self.detail}


def sniff_mime(path: Path) -> str | None:
    """Minimal magic-byte sniffing for the mime types we store."""
    try:
        head = path.open("rb").read(16)
    except OSError:
        return None
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if head.startswith(b"\xff\xd8"):
        return "image/jpeg"
    if head.startswith(b"ID3"):
        return "audio/mpeg"
    if len(head) >= 2 and head[0] == 0xFF and (head[1] & 0xE0) == 0xE0:
        return "audio/mpeg"
    return None


def probe_audio(path: Path) -> tuple[int | None, str | None]:
    """Return (duration_ms, error). error is None when ffprobe can read a
    decodable audio duration."""
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "json", str(path)],
            capture_output=True, text=True, timeout=60, check=True)
    except (OSError, subprocess.SubprocessError) as e:
        return None, f"ffprobe failed: {e}"
    try:
        duration = float(json.loads(out.stdout)["format"]["duration"])
    except (ValueError, KeyError, TypeError):
        return None, "ffprobe returned no readable duration"
    return round(duration * 1000), None


def build_source_index(source_roots: list[Path],
                       source_system: str = "raw_local") -> dict[str, SourceFile]:
    """Index candidate files by recomputed SHA-256.

    Only local files declared by a Raw ``resources.json`` manifest (the
    confirmed sample layout) are considered; undeclared strays are ignored.
    Unreadable/missing manifest entries are skipped and reported as warnings
    by the caller via index_warnings.
    """
    index: dict[str, SourceFile] = {}
    warnings: list[str] = []
    for root in source_roots:
        root = Path(root)
        for manifest_path in sorted(root.rglob("resources.json")):
            try:
                entries = json.loads(manifest_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as e:
                warnings.append(f"unreadable manifest {manifest_path}: {e}")
                continue
            if not isinstance(entries, list):
                warnings.append(f"manifest is not a list: {manifest_path}")
                continue
            base = manifest_path.parent
            for entry in entries:
                rel = entry.get("path") if isinstance(entry, dict) else None
                if not rel:
                    continue
                f = base / rel
                try:
                    digest = _sha256_file(f)
                except OSError as e:
                    warnings.append(f"unreadable source {f}: {e}")
                    continue
                index.setdefault(digest, SourceFile(
                    path=f, source_system=source_system,
                    source_path=rel, declared_size=entry.get("size"),
                    declared_mime=entry.get("contentType")))
    return index


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _atomic_copy(src: Path, target: Path) -> None:
    """Copy bytes into place via temp file + atomic rename (same dir)."""
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=".tmp-", dir=str(target.parent))
    tmp = Path(tmp_name)
    try:
        with open(fd, "wb") as out, src.open("rb") as inp:
            shutil.copyfileobj(inp, out, 1024 * 1024)
            out.flush()
            os.fsync(out.fileno())
        os.replace(tmp, target)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise


def _upsert_storage_row(engine: Engine, asset_id: str, state: str,
                        rule_version: str, *, stored_sha256: str | None,
                        stored_size: int | None, stored_mime: str | None,
                        verified_duration_ms: int | None,
                        source_system: str | None, source_path: str | None,
                        last_error: dict | None) -> None:
    with engine.begin() as conn:
        conn.execute(text(
            "INSERT INTO media_storage (asset_id, state, stored_sha256,"
            " stored_size_bytes, stored_mime_type, verified_duration_ms,"
            " source_system, source_path, rule_version, last_checked_at,"
            " last_error)"
            " VALUES (:a, :st, :sha, :size, :mime, :dur, :ss, :sp, :rv, now(),"
            " CAST(:err AS jsonb))"
            " ON CONFLICT (asset_id) DO UPDATE SET"
            " state = EXCLUDED.state, stored_sha256 = EXCLUDED.stored_sha256,"
            " stored_size_bytes = EXCLUDED.stored_size_bytes,"
            " stored_mime_type = EXCLUDED.stored_mime_type,"
            " verified_duration_ms = EXCLUDED.verified_duration_ms,"
            " source_system = EXCLUDED.source_system,"
            " source_path = EXCLUDED.source_path,"
            " rule_version = EXCLUDED.rule_version,"
            " last_checked_at = now(), last_error = EXCLUDED.last_error"),
            {"a": asset_id, "st": state, "sha": stored_sha256,
             "size": stored_size, "mime": stored_mime, "dur": verified_duration_ms,
             "ss": source_system, "sp": source_path, "rv": rule_version,
             "err": json.dumps(last_error, ensure_ascii=False) if last_error else None})


def sync_assets(engine: Engine, assets: list[dict],
                source_index: dict[str, SourceFile], storage_dir: Path,
                index_warnings: list[str] | None = None,
                rule_version: str = MEDIA_SYNC_VERSION) -> dict:
    """Validate + store each Canonical asset; upsert one media_storage row.

    Idempotent: identical content already stored is left untouched; a
    corrupted stored file is replaced atomically only after the new source
    fully validates.
    """
    storage_dir = Path(storage_dir)
    stored = 0
    issues: list[SyncIssue] = []
    warnings: list[str] = list(index_warnings or [])

    for rec in assets:
        asset_id = rec.get("id", "")
        sha = rec.get("sha256") or ""
        mime = (rec.get("mime_type") or "").lower()
        declared_size = rec.get("size_bytes")
        declared_duration = rec.get("duration_ms")

        def fail(reason: str, detail: str) -> None:
            issues.append(SyncIssue(asset_id, reason, detail))
            _upsert_storage_row(engine, asset_id, "unavailable", rule_version,
                                stored_sha256=None, stored_size=None,
                                stored_mime=mime or None,
                                verified_duration_ms=None,
                                source_system=None, source_path=None,
                                last_error={"reason": reason, "detail": detail})

        if not asset_id or not _SHA_RE.fullmatch(sha):
            issues.append(SyncIssue(asset_id or "?", "invalid_hash",
                                    "missing asset id or sha256 not 64-char hex"))
            continue  # cannot key a row without asset_id/sha
        src = source_index.get(sha)
        if src is None:
            fail("source_missing",
                 "no local file with this content hash in configured sources")
            continue

        try:
            actual_size = src.path.stat().st_size
        except OSError as e:
            fail("source_missing", f"source unreadable: {e}")
            continue
        if declared_size is not None and actual_size != declared_size:
            fail("size_mismatch",
                 f"actual {actual_size}B != canonical record {declared_size}B")
            continue

        # Re-hash at copy time: guards against source changing after index.
        try:
            actual_sha = _sha256_file(src.path)
        except OSError as e:
            fail("source_missing", f"source unreadable: {e}")
            continue
        if actual_sha != sha:
            fail("hash_mismatch",
                 f"content hash changed between index and copy ({actual_sha})")
            continue

        sniffed = sniff_mime(src.path)
        if sniffed is None:
            fail("mime_unknown", "file signature matches no supported type")
            continue
        if mime and sniffed != mime:
            fail("mime_mismatch", f"sniffed {sniffed} != canonical {mime}")
            continue

        verified_duration: int | None = None
        if mime.startswith("audio/"):
            verified_duration, err = probe_audio(src.path)
            if err is not None:
                fail("audio_unplayable", err)
                continue
            if (declared_duration is not None and verified_duration is not None
                    and abs(verified_duration - declared_duration)
                    > _DURATION_TOLERANCE_MS):
                warnings.append(
                    f"{asset_id}: duration drift declared={declared_duration}ms "
                    f"actual={verified_duration}ms (exceeds "
                    f"{_DURATION_TOLERANCE_MS}ms tolerance)")

        target = storage_dir / storage_rel_path(sha, mime or "")
        if target.exists():
            try:
                existing_sha = _sha256_file(target)
            except OSError as e:
                fail("store_unreadable", f"existing stored file unreadable: {e}")
                continue
            if existing_sha != sha:
                # Corrupted store: replace atomically with validated content.
                warnings.append(
                    f"{asset_id}: stored file content mismatch, repairing")
                _atomic_copy(src.path, target)
        else:
            _atomic_copy(src.path, target)

        _upsert_storage_row(engine, asset_id, "stored", rule_version,
                            stored_sha256=sha, stored_size=actual_size,
                            stored_mime=mime or sniffed,
                            verified_duration_ms=verified_duration,
                            source_system=src.source_system,
                            source_path=src.source_path,
                            last_error=None)
        stored += 1

    return {
        "rule_version": rule_version,
        "assets_total": len(assets),
        "stored": stored,
        "unavailable": len(issues),
        "issues": [i.as_dict() for i in issues],
        "warnings": warnings,
        "checked_at": datetime.now(timezone.utc).isoformat(),
    }


def main(argv: list[str] | None = None) -> int:
    import argparse
    import sys

    parser = argparse.ArgumentParser(
        description="Sync Canonical package media into controlled storage")
    parser.add_argument("package", help="Canonical package dir or .zip")
    parser.add_argument("--source-root", action="append", default=[],
                        help="read-only local source root (repeatable)")
    parser.add_argument("--storage-dir", default=None,
                        help="media storage root (default: MEDIA_STORAGE_DIR "
                             "env or <repo>/data/v2-media)")
    args = parser.parse_args(argv)

    if not args.source_root:
        parser.error("at least one --source-root is required")
        return 2

    from app.db.engine import get_engine
    from app.importer.reader import load_archive

    root = (Path(args.storage_dir) if args.storage_dir
            else Path(os.environ.get("MEDIA_STORAGE_DIR")
                      or Path(__file__).resolve().parents[2] / "data" / "v2-media"))

    packages = load_archive(Path(args.package))
    if len(packages) != 1:
        print(json.dumps({"ok": False,
                          "error": f"expected 1 package, found {len(packages)}"}),
              file=sys.stderr)
        return 1
    assets = packages[0].records.get("assets.jsonl", [])
    index = build_source_index([Path(p) for p in args.source_root])
    result = sync_assets(get_engine(), assets, index, root)
    print(json.dumps({"ok": True, "package": packages[0].package_id, **result},
                     ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
