import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

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
    // Public (guests may browse): home, exam catalog, exam detail. Starting
    // practice from the detail page sends guests to /login (ADR-0036).
    index("routes/study._index.tsx"),
    route("exams", "routes/study.exams._index.tsx"),
    route("exams/:examId", "routes/study.exams.$examId.tsx"),
    // Everything else needs a signed-in student.
    layout("routes/_require-auth.tsx", { id: "require-auth-study" }, [
      route("account", "routes/study.account.tsx"),
      route("exams/:examId/mock", "routes/study.exams.$examId.mock.tsx"),
      route("mock/:sessionId/results", "routes/study.mock.$sessionId.results.tsx"),
      route("learning", "routes/study.learning.tsx"),
      route("practice", "routes/study.practice._index.tsx"),
      route("answer-distribution", "routes/study.answer-distribution.tsx"),
      route("supplementary", "routes/study.supplementary.tsx"),
      route("practice/:sessionId", "routes/study.practice.$sessionId.tsx"),
      route(
        "practice/:sessionId/results",
        "routes/study.practice.$sessionId.results.tsx",
      ),
      // DEV-ONLY render harness (VITE_DEV_TOOLS=1); never linked from nav.
      route("dev/unit/:unitId", "routes/study.dev.unit.$unitId.tsx"),
      route("dev/select", "routes/study.dev.select.tsx"),
    ]),
  ]),
  // Strict mock exam mode: outside the study layout (ADR-0019 / ADR-0020),
  // but behind the same auth guard.
  layout("routes/_require-auth.tsx", { id: "require-auth-mock" }, [
    route("mock/:sessionId", "routes/mock.$sessionId.tsx"),
  ]),
  route("login", "routes/_auth.login.tsx"),
  route("register", "routes/_auth.register.tsx"),
  route("verify-email", "routes/_auth.verify-email.tsx"),
  route("forgot-password", "routes/_auth.forgot-password.tsx"),
  route("reset-password", "routes/_auth.reset-password.tsx"),
] satisfies RouteConfig;
