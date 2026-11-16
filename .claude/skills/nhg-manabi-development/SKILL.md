---
name: nhg-manabi-development
description: Use for any implementation, debugging, review, test, refactor, schema, API, frontend, content-pipeline, or development-planning task in the nhg-manabi-v2 repository. Enforces the repository's document-first workflow, project isolation, verification, devlog, progress, and commit requirements.
---

# JLPT GO 2.0 development workflow

Use this skill for every development task in `nhg-manabi-v2`, including tasks that appear small. The repository documents are the maintained source of truth; do not rely on remembered project state or copy rules from JLPT GO 1.0.

## Before changing anything

1. Confirm the repository root is `nhg-manabi-v2`. Never modify the separate `nhg-manabi` 1.0 project.
2. Read these files completely:
   - `AGENTS.md`
   - `docs/README.md`
   - `docs/decisions/README.md`
   - `docs/devlog/progress.md`
3. Inspect `git status --short --branch`, recent commits, and the target files. Preserve unrelated or concurrent changes; do not overwrite them or fold them into the task's commit.
4. Read the task-specific documents below before proposing or implementing a solution.
5. State the task scope, applicable constraints, actual current implementation state, and any conflicts between documentation and code. Do not treat a plan, suggestion, or uncommitted code as completed functionality.

## Document routing

Read only the relevant branch in addition to the four mandatory files above. Follow links from those documents when they identify another authoritative dependency.

- Frontend or React: `docs/design/design-system.md`, `docs/design/frontend-spec.md`, `docs/design/page-structure.md`, `docs/design/responsive-design.md`; for learning interactions also read `docs/design/practice-interactions.md`.
- Practice, answers, sessions, feedback, or results: `docs/product/business-rules.md`, `docs/design/practice-interactions.md`, `docs/architecture/postgresql-schema-v0.2.md`, `docs/development/api-conventions.md`.
- API or backend: `docs/architecture/system-architecture.md`, `docs/development/api-conventions.md`, `docs/development/testing-strategy.md`, plus the relevant product/data specification.
- Database or migration: `docs/architecture/postgresql-schema-v0.2.md`, `docs/architecture/implementation-notes.md`, `docs/development/testing-strategy.md`, and current Alembic revisions.
- Canonical content, importer, ETL, or media: `docs/architecture/canonical-schema-v2.0.md`, `docs/data/import-spec.md`, `docs/data/content-review-policy.md`, `docs/data/agent-validation-contract.md`.
- Review, publish, or release: `docs/data/content-review-policy.md`, `docs/architecture/validation-report.md`, relevant ADRs, and publisher tests.
- M2 learning flow: `docs/development/M2-core-learning-flow.md`; for the React phase also read `docs/development/M2.2-frontend-implementation.md` and ADR-0007.
- Deployment: `docs/development/deployment.md` and relevant architecture/ADR documents.
- v1 behavior: consult `docs/reference/v1/` only as read-only historical context. It never overrides v2 decisions.

## While working

- Treat the user's latest explicit decision as highest priority, followed by accepted decisions and current topic specifications. Surface conflicts instead of silently choosing.
- Keep FastAPI/PostgreSQL and the established Canonical/Release boundaries unless the task explicitly changes architecture; architecture changes require an ADR.
- Never expose Draft, unreviewed answers, explanations, private sources, or another user's study data through public/student APIs.
- Write or update focused acceptance tests before or with implementation. Implement the smallest complete task; do not expand scope through incidental cleanup.
- For Schema changes, create a new Alembic revision and verify real PostgreSQL upgrade, constraints, and rollback. Do not create tables at application runtime.
- Use the server as authority for identity, Session state, submitted answers, feedback permission, and results. Client hiding is not an authorization boundary.
- Run checks proportional to the changed area and record their real outputs. Never report a skipped or unavailable check as passed.
- Do not publish content, modify production data, push Git commits, or touch external systems unless the user explicitly authorizes that action.

## Before declaring completion

Complete all repository closeout requirements in the same change:

1. Add a dated Markdown entry under `docs/devlog/` describing scope, changes, decisions, actual tests/results, skipped checks, and remaining risks.
2. Update `docs/devlog/progress.md` to match the repository's real state without overstating completion.
3. Add or update an ADR only when architecture or a durable product decision changed.
4. Run `git diff --check`, the relevant tests/static checks, and inspect the final diff and worktree for unrelated files.
5. Commit implementation, tests, devlog, progress, and any ADR together. Do not include another agent's or user's unrelated changes. Do not push unless explicitly asked.
6. Report the commit ID, verification results, skipped checks, remaining risks, and whether the branch is ahead of its remote.

If the task is only an investigation or review and the user did not request changes, do not create a commit or mutate project files; report findings with file evidence instead.
