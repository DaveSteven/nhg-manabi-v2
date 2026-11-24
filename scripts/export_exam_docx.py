#!/usr/bin/env python3
"""Export Canonical v2.0 package directories to Word (.docx), offline.

  <exam_id>-試題.docx        question paper, no answers
  <exam_id>-答案与解析.docx   answer key, explanations and listening transcripts

Usage (from repo root, with python-docx available, e.g. backend/.venv):
  python3 scripts/export_exam_docx.py OUT_DIR PACKAGE_DIR [PACKAGE_DIR ...]

The same renderer backs the admin download endpoint (backend/app/exam_docx.py).
"""
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "backend"))
from app.exam_docx import build_answers, build_paper, load_package_dir  # noqa: E402

MEDIA = REPO / "data" / "v2-media"


def main(argv: list[str]) -> int:
    if len(argv) < 3:
        print(__doc__)
        return 2
    out_dir = Path(argv[1])
    out_dir.mkdir(parents=True, exist_ok=True)
    for d in argv[2:]:
        pkg = load_package_dir(Path(d))
        eid = pkg.exam["id"]
        build_paper(pkg, out_dir / f"{eid}-試題.docx", MEDIA)
        build_answers(pkg, out_dir / f"{eid}-答案与解析.docx", MEDIA)
        print(f"{eid}: {len(pkg.questions)} questions -> {out_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
