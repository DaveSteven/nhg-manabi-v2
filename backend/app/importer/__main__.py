"""CLI: stage Canonical packages from a zip or directory.

Usage:
    DATABASE_URL=... python -m app.importer /path/to/Archive.zip

Stages (import_jobs/import_records/source_mappings) and, by default
(PUBLISH_POLICY=auto, ADR-0010), publishes the staged package. Use
--no-publish or PUBLISH_POLICY=gated to stage only and keep the review gates.
"""
import argparse
import json
import os
import sys
from pathlib import Path

from app.db.engine import get_engine
from app.importer.errors import ImportError_ as CanonicalImportError
from app.importer.staging import stage_archive
from app.importer.reader import load_archive


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Canonical staging importer")
    parser.add_argument("path", type=Path, help="Archive.zip or package directory")
    parser.add_argument("--no-publish", action="store_true",
                        help="stage only (also: PUBLISH_POLICY=gated)")
    args = parser.parse_args(argv)
    publish = (not args.no_publish
               and os.environ.get("PUBLISH_POLICY", "auto").lower() != "gated")

    try:
        packages = load_archive(args.path)
    except CanonicalImportError as e:
        print(json.dumps({"ok": False, "stage": "read", "error": str(e)}), file=sys.stderr)
        return 1

    engine = get_engine()
    results = []
    try:
        results = stage_archive(engine, packages)
    except CanonicalImportError as e:
        print(json.dumps({"ok": False, "stage": "validate/stage", "error": str(e)}),
              file=sys.stderr)
        return 1

    ok = True
    for r in results:
        entry = r.as_dict()
        entry["ok"] = True
        if publish and r.state == "staged":
            from app.publisher import auto_publish_package
            try:
                entry["published"] = auto_publish_package(engine, r.package_id)
            except CanonicalImportError as e:
                entry["ok"] = False
                entry["publish_error"] = str(e)
                ok = False
        print(json.dumps(entry, ensure_ascii=False))
        if r.state != "staged" and not r.idempotent:
            ok = False
    summary = {
        "ok": ok,
        "packages": len(results),
        "idempotent_replays": sum(1 for r in results if r.idempotent),
    }
    print(json.dumps(summary, ensure_ascii=False))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
