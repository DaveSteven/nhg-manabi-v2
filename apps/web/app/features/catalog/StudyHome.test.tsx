import { beforeAll, afterAll, afterEach, describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../../test/mocks/server";
import { createQueryClient } from "../../api/queryClient";
import { renderRoutes } from "../../test/render";
import StudyLayout from "../../routes/study";
import { StudyHome } from "./StudyHome";

const session = {
  id: "s-1",
  mode: "practice",
  feedback_mode: "immediate",
  state: "in_progress",
  config: { requested_units: [{ release_id: "r", unit_id: "u01" }] },
  version: 1,
  created_at: "2026-11-16T00:00:00+00:00",
  ended_at: null,
  units: [
    { id: "su-1", release_id: "r", unit_id: "u01", position: 1,
      state: "submitted", submitted_at: "x" },
    { id: "su-2", release_id: "r", unit_id: "u02", position: 2,
      state: "pending", submitted_at: null },
  ],
};

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderHome(queryClient?: ReturnType<typeof createQueryClient>) {
  renderRoutes(
    [{ path: "study", Component: StudyLayout,
       children: [{ index: true, Component: StudyHome }] }],
    "/study",
    queryClient,
  );
}

describe("StudyHome", () => {
  it("renders four subject entries as the first visual focus", async () => {
    renderHome();
    const grid = await screen.findByRole("region", { name: "四学科入口" });
    expect(grid).toBeInTheDocument();
    for (const label of ["文字词汇", "文法", "读解", "听力"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("shows a continue card when an active session exists", async () => {
    server.use(http.get(`*/api/practice/sessions/current`, () =>
      HttpResponse.json(session)));
    renderHome();
    const card = await screen.findByRole("region", { name: "继续上次练习" });
    expect(card).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "继续练习" });
    expect(link).toHaveAttribute("href", "/study/practice/s-1");
    expect(screen.getByText(/组已提交/).textContent).toContain("1");
  });

  it("quietly omits the continue card when no session is active (404 is not an error)", async () => {
    renderHome();
    await screen.findByRole("region", { name: "四学科入口" });
    expect(screen.queryByRole("region", { name: "继续上次练习" }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("unauthenticated current-session is quiet, not an error banner", async () => {
    server.use(http.get(`*/api/practice/sessions/current`, () =>
      HttpResponse.json({ detail: "bearer token required" }, { status: 401 })));
    renderHome();
    await screen.findByRole("region", { name: "四学科入口" });
    expect(screen.queryByRole("region", { name: "继续上次练习" }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("catalog network errors render an explicit alert", async () => {
    // retry:false so the 500 settles immediately for the alert assertion.
    const qc = createQueryClient();
    qc.setQueryDefaults(["exams"], { retry: false });
    server.use(http.get(`*/api/exams`, () =>
      HttpResponse.json({ detail: "boom" }, { status: 500 })));
    renderHome(qc);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("无法连接学习服务");
  });

  it("shows an explicit empty state for an empty catalog", async () => {
    renderHome();
    expect(await screen.findByText("暂无已发布试卷。")).toBeInTheDocument();
  });
});
