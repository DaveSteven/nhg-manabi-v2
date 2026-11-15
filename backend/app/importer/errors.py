"""Importer exception types."""
from pathlib import Path


class ImportError_(Exception):
    """Base class for importer failures."""


class PackageReadError(ImportError_):
    """Archive/layout problems: unreadable files, missing manifest, bad JSON."""


class ChecksumError(PackageReadError):
    """manifest.files sha256/bytes mismatch or missing entry."""


class ValidationError(ImportError_):
    """Structural validation failed; message carries the error issues."""

    def __init__(self, issues: list[dict]):
        self.issues = issues
        summary = "; ".join(f"[{i['code']}] {i['location']}: {i['message']}" for i in issues)
        super().__init__(f"{len(issues)} validation error(s): {summary}")


class StagingError(ImportError_):
    """Database staging failed; diagnostics were rolled back with the transaction."""

    def __init__(self, message: str, diagnostics_path: Path | None = None):
        self.diagnostics_path = diagnostics_path
        suffix = f" (diagnostics: {diagnostics_path})" if diagnostics_path else ""
        super().__init__(message + suffix)
