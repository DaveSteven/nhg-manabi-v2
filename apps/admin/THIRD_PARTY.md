# Third-party code

`apps/admin` is derived from **satnaing/shadcn-admin** (ADR-0008).

| Item | Value |
|---|---|
| Upstream | https://github.com/satnaing/shadcn-admin |
| Version imported | v2.2.1 (package.json), imported unmodified in commit `f1d58ca` |
| License | MIT — see `LICENSE` (retained unchanged) |

## Local changes (reviewable via `git log -- apps/admin`)

- Removed Clerk integration (`@clerk/react`, `routes/clerk`, Clerk logo) and all
  demo pages/features with mock data (apps, chats, tasks, users, settings,
  dashboard, help-center, error demos) and unused auth pages (sign-up,
  forgot-password, otp, sign-in-2).
- Replaced the mock sign-in with real login against the FastAPI admin endpoints
  (ADR-0009/0010): `src/lib/api.ts`, `src/stores/auth-store.ts`
  (token in `sessionStorage`), server-validated route guard in
  `src/routes/_authenticated/route.tsx`.
- `index.html`: removed Open Graph/Twitter metadata and the Google Fonts links;
  added `noindex`. Vite dev proxy `/api` → `BACKEND_URL` (default `http://localhost:8001`), port 5175.
- Added a fast unit-test config (`vitest.unit.config.ts`, happy-dom). The upstream
  browser-mode suite (`pnpm test`) needs Playwright Chromium and has not been run here.

## Build scripts

The workspace does not approve dependency install scripts except `esbuild` and
`msw`; `@parcel/watcher`'s build script is intentionally left unapproved.

## Upgrading

Do not follow upstream `main` automatically. Diff the target tag against the
imported baseline, review dependencies/scripts/network calls, then merge as a
separate task.
