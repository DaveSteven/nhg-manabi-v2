import { beforeAll, afterAll, afterEach, describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../../test/mocks/server";
import { createQueryClient } from "../../api/queryClient";
import { renderRoutes } from "../../test/render";
import StudyLayout from "../../routes/study";
import { StudyHome } from "./StudyHome";
import { authStore } from "../auth/authStore";

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
    { id: "su-1", release_id: "r", exam_id: "N2-2024-12", unit_id: "u01", position: 1,
      state: "submitted", submitted_at: "x" },
    { id: "su-2", release_id: "r", exam_id: "N2-2024-12", unit_id: "u02", position: 2,
      state: "pending", submitted_at: null },
  ],
};

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  authStore.clear();
  window.localStorage.clear();
});
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
  it("renders the page header and four subject entries", async () => {
    renderHome();
    expect(screen.getByRole("heading", { level: 1 }))
      .toHaveTextContent("开始今天的日语练习");
    const grid = await screen.findByRole("region", { name: "专项练习入口" });
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
    expect(screen.getByText(/已提交 1 \/ 2 组/).textContent).toContain("1");
  });

  it("labels the continue card with the exam bound to the session release", async () => {
    server.use(
      http.get(`*/api/practice/sessions/current`, () =>
        HttpResponse.json(session)),
      http.get(`*/api/exams`, () => HttpResponse.json([{
        exam_id: "N2-2024-12",
        release_id: "r",
        revision: 1,
        level: "N2",
        year: 2024,
        month: 12,
        title: "2024年12月 N2",
        question_count: 96,
      }])),
    );
    renderHome();
    await screen.findByRole("region", { name: "继续上次练习" });
    expect(screen.getByText("N2 · 2024年12月试卷")).toBeInTheDocument();
  });

  it("quietly omits the continue card when no session is active (404 is not an error)", async () => {
    renderHome();
    await screen.findByRole("region", { name: "专项练习入口" });
    expect(screen.queryByRole("region", { name: "继续上次练习" }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("unauthenticated current-session is quiet, not an error banner", async () => {
    server.use(http.get(`*/api/practice/sessions/current`, () =>
      HttpResponse.json({ detail: "bearer token required" }, { status: 401 })));
    renderHome();
    await screen.findByRole("region", { name: "专项练习入口" });
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

  it("renders compact quick entries for the first three exams", async () => {
    const exams = [2024, 2023, 2022, 2021].map((year, i) => ({
      exam_id: `N2-${year}-12`,
      release_id: `rel-${year}`,
      revision: 1,
      level: "N2",
      year,
      month: 12,
      title: `${year}年12月 N2`,
      question_count: 96,
    })).slice(0, 4);
    server.use(http.get(`*/api/exams`, () => HttpResponse.json(exams)));
    renderHome();
    await screen.findByText("2022年");
    const links = screen.getAllByRole("link", { name: /202\d年/ });
    expect(links).toHaveLength(3);
    expect(links[0]).toHaveAttribute("href", "/study/exams/N2-2024-12");
    expect(screen.getByText("2022年")).toBeInTheDocument();
    expect(screen.queryByText("2021年")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /查看全部/ }))
      .toHaveAttribute("href", "/study/exams");
  });

  describe("target level filter on the home exam entry", () => {
    const exam = (id: string, level: string, year: number) => ({
      exam_id: id, level, month: 7, release_id: `r-${id}`, revision: 1,
      title: `${level} ${year}`, year, question_count: 96,
    });
    const USER = { id: "u1", email: "a@example.com", display_name: "小明",
                   current_level: "N2" as const, avatar: null };

    it("shows only the signed-in student's level", async () => {
      server.use(http.get(`*/api/exams`, () => HttpResponse.json([
        exam("a", "N1", 2025), exam("b", "N2", 2024), exam("c", "N2", 2023),
        exam("d", "N5", 2022),
      ])));
      authStore.setSession("tok", USER);
      renderHome();
      const entry = await screen.findByRole("region", { name: "历年试卷入口" });
      expect(await within(entry).findByText("2024年")).toBeInTheDocument();
      expect(within(entry).getByText("2023年")).toBeInTheDocument();
      expect(within(entry).queryByText("2025年")).not.toBeInTheDocument();
      expect(within(entry).queryByText("2022年")).not.toBeInTheDocument();
    });

    it("explains an empty level instead of showing other levels", async () => {
      server.use(http.get(`*/api/exams`, () => HttpResponse.json([
        exam("a", "N1", 2025),
      ])));
      authStore.setSession("tok", USER);
      renderHome();
      expect(await screen.findByText(/暂无 N2 已发布试卷/)).toBeInTheDocument();
      expect(screen.queryByText("2025年")).not.toBeInTheDocument();
    });

    it("without a level, shows the latest exams of all levels", async () => {
      server.use(http.get(`*/api/exams`, () => HttpResponse.json([
        exam("a", "N1", 2025), exam("b", "N2", 2024),
      ])));
      renderHome();
      expect(await screen.findByText("2025年")).toBeInTheDocument();
      expect(screen.getByText("2024年")).toBeInTheDocument();
    });
  });
});
