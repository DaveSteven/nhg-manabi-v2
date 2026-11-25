import { beforeAll, afterAll, afterEach, describe, expect, it } from "vitest";
import { beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../../test/mocks/server";
import { createQueryClient } from "../../api/queryClient";
import { renderRoutes, signInForTest } from "../../test/render";
import StudyLayout from "../../routes/study";
import { StudyHome } from "./StudyHome";
import { authStore } from "../auth/authStore";

beforeEach(() => signInForTest());

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
      .toHaveTextContent("从 JLPT 开始，不止于考试");
    const grid = await screen.findByRole("region", { name: "专项练习入口" });
    expect(grid).toBeInTheDocument();
    for (const label of ["文字词汇", "文法", "读解", "听力"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("subject entries open 专项练习 with that subject preselected", async () => {
    renderHome();
    const grid = await screen.findByRole("region", { name: "专项练习入口" });
    const hrefs = within(grid).getAllByRole("link")
      .map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual([
      "/study/practice?subject=vocabulary", "/study/practice?subject=grammar",
      "/study/practice?subject=reading", "/study/practice?subject=listening",
    ]);
    expect(within(grid).queryByText(/暂未开放/)).not.toBeInTheDocument();
  });

  it("shows a continue card when an active session exists", async () => {
    server.use(http.get(`*/api/practice/sessions/current`, () =>
      HttpResponse.json(session)));
    renderHome();
    const card = await screen.findByRole("region", { name: "继续上次练习" });
    expect(card).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "继续练习" });
    expect(link).toHaveAttribute("href", "/study/practice/s-1");
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

  it("shows the exam countdown and no streak card without a streak response", async () => {
    server.use(http.get(`*/api/me/learning/streak`, () => HttpResponse.json({}, { status: 500 })));
    renderHome();
    const card = await screen.findByRole("region", { name: "考试倒计时" });
    expect(card).toHaveTextContent(/距考试\s*\d+\s*天|今天考试/);
  });

  it("shows the streak and this week's studied days when signed in", async () => {
    authStore.setSession("tok", {
      id: "9a1c66d0-1111-4111-8111-111111111111", email: "a@b.c",
      username: null, display_name: "A", current_level: "N2", avatar: null,
    });
    const dates = ["16", "17", "18", "19", "20", "21", "22"];
    server.use(http.get(`*/api/me/learning/streak`, () => HttpResponse.json({
      today: "2026-11-18", streak_days: 2, studied_today: true,
      week: dates.map((d, i) => ({ date: `2026-11-${d}`, studied: i < 3,
                                   is_today: i === 2 })),
      week_studied: 3,
    })));
    renderHome();
    const card = await screen.findByRole("region", { name: "连续学习" });
    expect(await within(card).findByText("本周 3/7")).toBeInTheDocument();
    expect(card).toHaveTextContent("2 天连续");
    expect(within(card).getAllByRole("img", { name: "已学习" })).toHaveLength(3);
    expect(card.querySelector('[aria-current="date"]')).not.toBeNull();
  });
});
