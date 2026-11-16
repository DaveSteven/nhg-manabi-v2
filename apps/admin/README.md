# Content administration application

Planned as an independent React + TypeScript/Vite SPA based on a reviewed,
pinned version of [`satnaing/shadcn-admin`](https://github.com/satnaing/shadcn-admin).
Keep the upstream visual theme; do not apply the student-facing Sakura & Ink
theme to this app.

No admin frontend has been generated yet. Before implementation, read:

- `docs/decisions/ADR-0008-shadcn-admin-foundation.md`
- `docs/development/admin-frontend-implementation.md`
- `docs/data/content-review-policy.md`

The upstream template is a UI/engineering foundation only. Remove Clerk,
sample credentials, demo business data and unrelated pages. FastAPI remains
the authority for admin identity, review, publishing and private content.
