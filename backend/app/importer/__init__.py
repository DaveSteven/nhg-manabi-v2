"""Canonical v2.0 staging importer.

Writes ONLY staging tables (import_jobs, import_records, source_mappings).
Never writes published content (exam_releases / release_* / registries);
publishing is a separate reviewed transaction.
"""
from app.importer.hashing import CONTENT_HASH_VERSION, compute_content_hash
from app.importer.reader import CanonicalPackage, load_archive
from app.importer.staging import ImportResult, stage_archive
from app.importer.validator import validate_package

__all__ = [
    "CONTENT_HASH_VERSION",
    "CanonicalPackage",
    "ImportResult",
    "compute_content_hash",
    "load_archive",
    "stage_archive",
    "validate_package",
]
