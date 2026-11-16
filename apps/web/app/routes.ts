import { type RouteConfig, index, route } from "@react-router/dev/routes";

/**
 * Route table (ADR-0007 / M2.2 §3):
 * - `/` brand home, statically prerendered.
 * - `/study/*` learning SPA under the study layout (noindex).
 */
export default [
  index("routes/_index.tsx"),
  route("study", "routes/study.tsx", [
    index("routes/study._index.tsx"),
    route("exams", "routes/study.exams._index.tsx"),
    route("exams/:examId", "routes/study.exams.$examId.tsx"),
    route("practice/:sessionId", "routes/study.practice.$sessionId.tsx"),
    route(
      "practice/:sessionId/results",
      "routes/study.practice.$sessionId.results.tsx",
    ),
  ]),
] satisfies RouteConfig;
