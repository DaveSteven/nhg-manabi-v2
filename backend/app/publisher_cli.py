"""CLI: publish staged packages / promote releases.

Usage:
    python -m app.publisher_cli publish JLPTGO-N2-2018-12-r1 [--reviewer id] [--notes ...]
    python -m app.publisher_cli promote <release_id> --reviewer id [--notes ...]
"""
import argparse
import json
import sys

from app.db.engine import get_engine
from app.importer.errors import ImportError_ as CanonicalImportError
from app.publisher import promote_release, publish_package


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Canonical release publisher")
    sub = parser.add_subparsers(dest="command", required=True)

    p_publish = sub.add_parser("publish")
    p_publish.add_argument("package_id")
    p_publish.add_argument("--content-hash", default=None)
    p_publish.add_argument("--reviewer", default=None)
    p_publish.add_argument("--notes", default=None)

    p_promote = sub.add_parser("promote")
    p_promote.add_argument("release_id")
    p_promote.add_argument("--reviewer", required=True)
    p_promote.add_argument("--notes", default=None)

    args = parser.parse_args(argv)
    engine = get_engine()
    try:
        if args.command == "publish":
            result = publish_package(engine, args.package_id,
                                     content_hash=args.content_hash,
                                     reviewer_id=args.reviewer,
                                     notes=args.notes)
        else:
            result = promote_release(engine, args.release_id,
                                     reviewer_id=args.reviewer,
                                     notes=args.notes)
    except CanonicalImportError as e:
        print(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False),
              file=sys.stderr)
        return 1
    print(json.dumps({"ok": True, **result}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
