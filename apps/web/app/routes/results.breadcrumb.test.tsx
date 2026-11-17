import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../test/mocks/server";
import { renderRoutes } from "../test/render";
import ResultsRoute from "./study.practice.$sessionId.results";
import results from "../api/contract-fixtures/results-get.json";
import sessionGet from "../api/contract-fixtures/session-get.json";

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderResults() {
  renderRoutes([{ path: "study/practice/:sessionId/results", Component: ResultsRoute }],
    "/study/practice/s-1/results");
}

describe("results page breadcrumb", () => {
  it("shows 试卷 › 详情 › 结果 with 详情 linking to the session's exam", async () => {
    server.use(
      http.get("*/api/practice/sessions/s-1/results", () =>
        HttpResponse.json(results.body)),
      http.get("*/api/practice/sessions/s-1", () =>
        HttpResponse.json(sessionGet.body)),
    );
    renderResults();
    const nav = await screen.findByRole("navigation", { name: "面包屑" });
    const detail = await within(nav).findByRole("link", { name: "详情" });
    expect(detail).toHaveAttribute("href",
      `/study/exams/${sessionGet.body.units[0]!.exam_id}`);
    expect(within(nav).getByText("结果")).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("heading", { level: 1, name: "练习结果" })).toBeInTheDocument();
  });

  it("omits 详情 instead of guessing when the session can't be read", async () => {
    server.use(
      http.get("*/api/practice/sessions/s-1/results", () =>
        HttpResponse.json(results.body)),
      http.get("*/api/practice/sessions/s-1", () =>
        HttpResponse.json({ detail: "not found" }, { status: 404 })),
    );
    renderResults();
    const nav = await screen.findByRole("navigation", { name: "面包屑" });
    expect(within(nav).getByRole("link", { name: "试卷" })).toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: "详情" })).not.toBeInTheDocument();
    expect(within(nav).getByText("结果")).toBeInTheDocument();
  });

  it("also appears on the early-end page", async () => {
    server.use(
      http.get("*/api/practice/sessions/s-1/results", () =>
        HttpResponse.json({ detail: { code: "no_results_early_end",
          message: "ended early" } }, { status: 409 })),
      http.get("*/api/practice/sessions/s-1", () =>
        HttpResponse.json(sessionGet.body)),
    );
    renderResults();
    expect(await screen.findByRole("heading", { name: "练习已提前结束" }))
      .toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "面包屑" });
    expect(await within(nav).findByRole("link", { name: "详情" })).toBeInTheDocument();
  });
});
