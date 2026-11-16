# Claude Code project entrypoint

@AGENTS.md

Before planning, reviewing, debugging, testing, or changing this repository:

1. Read `AGENTS.md` completely. Treat it as the repository-level instruction and safety source; this file does not replace it.
2. For every development task, load and follow `.claude/skills/nhg-manabi-development/SKILL.md` before taking action, even when the requested change appears small.
3. Read the current `docs/README.md`, `docs/decisions/README.md`, and `docs/devlog/progress.md`, then follow the skill's task-specific document routing.
4. Inspect the worktree and actual implementation before describing project state. Do not treat plans, stale summaries, or uncommitted work as completed functionality.
5. Perform ordinary development and commits on `develop`. Treat `main` as the record of successfully deployed code; merge `develop` into `main` only after a successful deployment and explicit user confirmation.

Never modify the separate JLPT GO 1.0 project. Do not bypass the v2 content-review, answer-visibility, identity, Release, test, devlog, progress, ADR, or commit requirements defined by `AGENTS.md` and the project skill.
