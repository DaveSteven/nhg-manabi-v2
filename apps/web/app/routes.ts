import { type RouteConfig, index, route } from "@react-router/dev/routes";

/**
 * Route table (ADR-0007 / M2.2 §3 / ADR-0011):
 * - `/` brand home, statically prerendered.
 * - `/study/*` learning SPA under the study layout (noindex).
 * - `/login /register /verify-email /forgot-password /reset-password`
 *   student auth SPA pages (noindex, no study shell).
 */
export default [
  index("routes/_index.tsx"),
  route("study", "routes/study.tsx", [
    index("routes/study._index.tsx"),
    route("account", "routes/study.account.tsx"),
    route("exams", "routes/study.exams._index.tsx"),
    route("exams/:examId", "routes/study.exams.$examId.tsx"),
    route("learning", "routes/study.learning.tsx"),
    route("practice", "routes/study.practice._index.tsx"),
    route("practice/:sessionId", "routes/study.practice.$sessionId.tsx"),
    route(
      "practice/:sessionId/results",
      "routes/study.practice.$sessionId.results.tsx",
    ),
    // DEV-ONLY render harness (VITE_DEV_TOOLS=1); never linked from nav.
    route("dev/unit/:unitId", "routes/study.dev.unit.$unitId.tsx"),
    route("dev/select", "routes/study.dev.select.tsx"),
  ]),
  route("login", "routes/_auth.login.tsx"),
  route("register", "routes/_auth.register.tsx"),
  route("verify-email", "routes/_auth.verify-email.tsx"),
  route("forgot-password", "routes/_auth.forgot-password.tsx"),
  route("reset-password", "routes/_auth.reset-password.tsx"),
] satisfies RouteConfig;
