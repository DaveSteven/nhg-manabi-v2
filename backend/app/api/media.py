"""Public media read API with publish/association gating.

GET /api/releases/{release_id}/assets/{asset_id}

Serves ONLY media that is ALL of:
- referenced by a release in state='published' (old releases stay
  readable — historical sessions pin their release, P-013/ADR-0004);
- referenced through a complete unit (blocked/needs_review units' media
  is not publicly served, mirroring the content API);
- present in media_storage with state='stored' and a stored hash equal
  to the Canonical asset's sha256.

Storage paths are derived content addresses under MEDIA_STORAGE_DIR and
never leave this module; disk layout is not part of any public DTO.
Everything that fails a gate is a uniform 404 — availability of
unpublished or unassociated media is not revealed.

HTTP Range (RFC 9110 single range) is supported for browser playback and
seeking: 206 + Content-Range, 416 + Content-Range: bytes */size for
unsatisfiable ranges, malformed Range headers are ignored (full body).
"""
import os
import re
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import Response, StreamingResponse
from sqlalchemy import text

from app.db.engine import get_engine

router = APIRouter()

_SHA_RE = re.compile(r"^[0-9a-f]{64}$")
_RANGE_RE = re.compile(r"^bytes=(\d*)-(\d*)$")
_CHUNK = 64 * 1024


def media_storage_root() -> Path:
    configured = os.environ.get("MEDIA_STORAGE_DIR")
    if configured:
        return Path(configured).resolve()
    # backend/app/api/media.py → repo root
    return (Path(__file__).resolve().parents[3] / "data" / "v2-media").resolve()


_ASSET_QUERY = text("""
    SELECT a.sha256, a.mime_type, s.stored_sha256
    FROM media_assets a
    JOIN media_storage s ON s.asset_id = a.id
    WHERE a.id = :asset_id
      AND a.availability <> 'corrupt'
      AND s.state = 'stored'
      AND (
        EXISTS (SELECT 1 FROM release_unit_materials m
                JOIN release_units u ON u.release_id = m.release_id
                                     AND u.unit_id = m.unit_id
                WHERE m.release_id = :rid AND m.asset_id = a.id
                  AND u.conversion_status = 'complete')
     OR EXISTS (SELECT 1 FROM release_question_media qm
                JOIN release_questions q ON q.release_id = qm.release_id
                                         AND q.question_id = qm.question_id
                JOIN release_units u ON u.release_id = q.release_id
                                     AND u.unit_id = q.unit_id
                WHERE qm.release_id = :rid AND qm.asset_id = a.id
                  AND q.conversion_status = 'complete'
                  AND u.conversion_status = 'complete')
     OR EXISTS (SELECT 1 FROM release_option_media om
                JOIN release_options o ON o.release_id = om.release_id
                                       AND o.option_id = om.option_id
                JOIN release_questions q ON q.release_id = o.release_id
                                         AND q.question_id = o.question_id
                JOIN release_units u ON u.release_id = q.release_id
                                     AND u.unit_id = q.unit_id
                WHERE om.release_id = :rid AND om.asset_id = a.id
                  AND q.conversion_status = 'complete'
                  AND u.conversion_status = 'complete')
     OR EXISTS (SELECT 1 FROM release_exam_media em
                WHERE em.release_id = :rid AND em.asset_id = a.id)
      )
""")

_EXT_BY_MIME = {
    "audio/mpeg": ".mp3",
    "image/png": ".png",
    "image/jpeg": ".jpg",
}


def _parse_range(header: str | None, size: int):
    """Return None (no/ignored range), 'unsatisfiable', or (start, end)."""
    if not header:
        return None
    m = _RANGE_RE.fullmatch(header.strip())
    if not m:
        return None  # malformed → ignore per RFC 9110
    start_s, end_s = m.groups()
    if start_s == "" and end_s == "":
        return None
    if start_s == "":  # suffix form: last N bytes
        n = int(end_s)
        if n == 0:
            return "unsatisfiable"
        return (max(0, size - n), size - 1)
    start = int(start_s)
    end = int(end_s) if end_s else size - 1
    if end_s and end < start:
        return None  # unsatisfiable-looking but syntactically invalid → ignore
    if start >= size:
        return "unsatisfiable"
    return (start, min(end, size - 1))


def _file_response(path: Path, mime_type: str, range_part, head_only: bool):
    size = path.stat().st_size
    common = {
        "media_type": mime_type,
        "headers": {
            "Accept-Ranges": "bytes",
            "Cache-Control": "public, max-age=31536000, immutable",
        },
    }
    if range_part == "unsatisfiable":
        return Response(status_code=416, headers={
            "Content-Range": f"bytes */{size}", **common["headers"]})
    if range_part is None:
        start, end = 0, size - 1
        status = 200
    else:
        start, end = range_part
        status = 206
    length = end - start + 1
    headers = {
        **common["headers"],
        "Content-Length": str(length),
    }
    if status == 206:
        headers["Content-Range"] = f"bytes {start}-{end}/{size}"
    if head_only:
        return Response(status_code=status, media_type=mime_type, headers=headers)

    def chunks():
        with path.open("rb") as fh:
            fh.seek(start)
            remaining = length
            while remaining > 0:
                data = fh.read(min(_CHUNK, remaining))
                if not data:
                    break
                remaining -= len(data)
                yield data

    return StreamingResponse(chunks(), status_code=status,
                             media_type=mime_type, headers=headers)


@router.api_route("/api/releases/{release_id}/assets/{asset_id}",
                  methods=["GET", "HEAD"])
def get_release_asset(release_id: str, asset_id: str, request: Request):
    engine = get_engine()
    with engine.connect() as conn:
        published = conn.execute(text(
            "SELECT 1 FROM exam_releases WHERE id = :r AND state = 'published'"),
            {"r": release_id}).scalar()
        if not published:
            return Response(media_type="application/json", status_code=404,
                            content='{"detail":"release not published"}')
        row = conn.execute(_ASSET_QUERY,
                           {"rid": release_id, "asset_id": asset_id}).first()
    if row is None or row.stored_sha256 != row.sha256:
        return Response(media_type="application/json", status_code=404,
                        content='{"detail":"asset unavailable"}')

    sha = row.sha256
    if not _SHA_RE.fullmatch(sha):
        return Response(media_type="application/json", status_code=404,
                        content='{"detail":"asset unavailable"}')
    ext = _EXT_BY_MIME.get((row.mime_type or "").lower(), ".bin")
    root = media_storage_root()
    path = (root / sha[:2] / sha[2:4] / f"{sha}{ext}").resolve()
    if root not in path.parents or not path.is_file():
        return Response(media_type="application/json", status_code=404,
                        content='{"detail":"asset unavailable"}')

    range_part = _parse_range(request.headers.get("range"), path.stat().st_size)
    return _file_response(path, row.mime_type or "application/octet-stream",
                          range_part, request.method == "HEAD")
