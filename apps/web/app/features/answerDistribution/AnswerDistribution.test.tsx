import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "../../test/mocks/server";
import { renderRoutes } from "../../test/render";
import { AnswerDistributionView } from "./AnswerDistribution";
import { summarize } from "./distributionModel";

const DATA = {
  types: [
    { question_type_id: "vocabulary_kanji_reading", subject: "vocabulary", label_zh: "汉字读音" },
    { question_type_id: "grammar_cloze", subject: "grammar", label_zh: "文章语法（完形填空）" },
  ],
  counts: [
    { level: "N5", question_type_id: "vocabulary_kanji_reading", position: 1, count: 3 },
    { level: "N5", question_type_id: "vocabulary_kanji_reading", position: 3, count: 1 },
    { level: "N2", question_type_id: "vocabulary_kanji_reading", position: 2, count: 4 },
    { level: "N2", question_type_id: "grammar_cloze", position: 4, count: 4 },
  ],
} as const;

beforeAll(() => server.listen());
afterEach(() => { server.resetHandlers(); localStorage.clear(); });
afterAll(() => server.close());

function render() {
  server.use(http.get("*/api/answer-distribution", () => HttpResponse.json(DATA)));
  return renderRoutes([{ path: "/study/answer-distribution",
                         Component: AnswerDistributionView }],
                      "/study/answer-distribution");
}

describe("summarize", () => {
  it("filters by level and type and keeps empty positions up to the max", () => {
    const s = summarize(DATA as never, "N5", "vocabulary_kanji_reading");
    expect(s.total).toBe(4);
    expect(s.bars.map((b) => b.count)).toEqual([3, 0, 1]);
    expect(s.bars[0]!.percent).toBe(75);
    expect(summarize(DATA as never, "all", "all").total).toBe(12);
    expect(summarize(DATA as never, "N1", "all").total).toBe(0);
  });
});

describe("AnswerDistributionView", () => {
  it("shows the overall distribution first and filters by level", async () => {
    const user = userEvent.setup();
    render();
    expect(await screen.findByText(/共 12 题/)).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "N5" }));
    expect(screen.getByText(/共 4 题/)).toBeInTheDocument();
    expect(screen.getAllByText("75.0%").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("tab", { name: "N1" }));
    expect(screen.getByText("该范围暂无统计数据。")).toBeInTheDocument();
  });

  it("per-type table lets you drill into one type", async () => {
    const user = userEvent.setup();
    render();
    await screen.findByText(/共 12 题/);
    await user.click(screen.getByRole("tab", { name: "N2" }));
    const table = screen.getByRole("table");
    expect(within(table).getByText("汉字读音")).toBeInTheDocument();
    await user.click(within(table).getByRole("button", { name: "汉字读音" }));
    expect(screen.getByText(/共 4 题/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("tells a logged-out user to sign in", async () => {
    server.use(http.get("*/api/answer-distribution", () =>
      HttpResponse.json({ detail: "unauthorized" }, { status: 401 })));
    renderRoutes([{ path: "/study/answer-distribution",
                    Component: AnswerDistributionView }],
                 "/study/answer-distribution");
    expect(await screen.findByText("请先登录后查看答案分布。")).toBeInTheDocument();
  });
});
