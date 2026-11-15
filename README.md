# nhg-manabi-v2 · JLPT GO 2.0

> **文档已补全（2026-11-15）**：新增 `AGENTS.md`、`docs/README.md` 与产品、设计、开发、数据审核和 ADR 规范；旧版 `frontend.md` / `database-schema.md` / `design-system.md` 原样收录到 `docs/reference/v1/`。遵循 `docs/README.md` 决策优先级。

Independent second-generation project scaffold. **The existing `nhg-manabi` application and its database are untouched.**

## Current status

- ✅ Independent repository layout, Postgres 16 Docker Compose (localhost-only port 55432)
- ✅ SQLAlchemy 2.0 PostgreSQL Core metadata for 32 tables (content, draft/release, import/review and future study entities)
- ✅ Alembic initial migration `0001_initial_schema`
- ✅ FastAPI `/health` process endpoint (not a DB-readiness endpoint)
- ✅ Canonical archive checksum/count verification utility and basic tests
- ⬜ No DB has been started or migrated here; Docker/PostgreSQL runtime unavailable in the artifact-generation environment
- ⬜ No actual Canonical → staging importer, publish transaction, API endpoints, authentication or React UI yet
- ⬜ Published-content immutability triggers and DB role separation still to be implemented before public release

## Requirements

- Docker with Compose
- Python 3.11+

## Getting started (local only)

```bash
cd nhg-manabi-v2
cp .env.example .env
# Edit .env and choose strong development-only credentials.
docker compose --env-file .env up -d postgres

cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'
set -a; source ../.env; set +a
alembic upgrade head
uvicorn app.main:app --reload --port 8001
```

Visit http://localhost:8001/health.

**DB name:** `nhg_manabi_v2` (underscores because PostgreSQL database identifiers cannot contain hyphens without quoting). **Container name:** `nhg-manabi-v2-db`.

## Run tests without a database

```bash
cd backend
pytest -q
alembic upgrade head --sql > /tmp/nhg-manabi-v2-initial.sql
```

For five converted test packages, place a copy of `Archive.zip` in `data/samples/` (not tracked by Git) and run:

```bash
python3 scripts/verify_canonical_archive.py data/samples/Archive.zip
```

This validates package integrity, **not** linguistic correctness, media binaries, licensing, or release eligibility.

## Architectural guardrails

1. Exchange schema: `docs/architecture/canonical-schema-v2.0.md`.
2. Database design: `docs/architecture/postgresql-schema-v0.2.md`.
3. New Canonical IDs are stable; `release_id` scopes each material, question, option and key.
4. Agent output and imported Canonical drafts go to staging, never directly to public releases.
5. An answer key is never exposed through ordinary student-facing endpoints.
6. Revisions and indexes are tracked by Alembic. Never edit old migration files after deployment.
7. Exam content may carry third-party copyright; converted data is **not** automatically licensed for distribution.

## Next milestone: M1 canonical staging importer

- Validate package manifest/file hash and referential integrity.
- Upsert per `(package_id, content_hash)` staging job.
- Persist source mappings and warning/needs_review status.
- After review/publishing policy is implemented, publish an immutable content release in one transaction.
- Verify sample totals: 83 Layers, 440 Units, 498 Questions, 204 assets across five packages.

The initial migration defines study tables for forward schema consistency; the study engine is **not** implemented yet. `user_id` is intentionally not linked to an auth table until the authentication module is designed.
