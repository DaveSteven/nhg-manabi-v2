import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "../../test/mocks/server";
import { renderRoutes } from "../../test/render";
import { AnswerDistributionView } from "./AnswerDistribution";
import { summarize, tint } from "./distributionModel";

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

describe("tint", () => {
  const bars = (counts: number[]) => {
    const total = counts.reduce((a, b) => a + b, 0);
    return { total, bars: counts.map((count, i) => ({
      position: i + 1, count, percent: (count / total) * 100 })) };
  };
  it("colours only clear deviations on a large sample", () => {
    const cells = tint(bars([200, 300, 300, 200])); // 20/30/30/20 of 1000
    expect(cells.map((c) => c.tone)).toEqual(["low", "high", "high", "low"]);
    expect(cells[1]!.strength).toBeGreaterThan(0);
  });
  it("never colours near-even or small samples", () => {
    expect(tint(bars([255, 245, 250, 250])).every((c) => c.tone === "none")).toBe(true);
    expect(tint(bars([1, 9, 1, 9])).every((c) => c.tone === "none")).toBe(true);
  });
});

describe("AnswerDistributionView", () => {
  it("shows the level's overall bars and a row per type, filtering by level", async () => {
    const user = userEvent.setup();
    render();
    expect(await screen.findByText(/全部题型 · 共 12 题/)).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "N5" }));
    expect(screen.getByText(/共 4 题/)).toBeInTheDocument();
    expect(screen.getAllByText("75.0%").length).toBeGreaterThan(0);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument(); // no type dropdown
    await user.click(screen.getByRole("tab", { name: "N1" }));
    expect(screen.getByText("该等级暂无统计数据。")).toBeInTheDocument();
  });

  it("clicking a type row opens its detail in place and toggles it closed", async () => {
    const user = userEvent.setup();
    render();
    await screen.findByText(/全部题型/);
    await user.click(screen.getByRole("tab", { name: "N2" }));
    const row = screen.getByRole("row", { name: /汉字读音/ });
    expect(row).toHaveTextContent("样本少"); // 4 questions < 30
    expect(screen.queryByRole("region", { name: "汉字读音 详情" })).not.toBeInTheDocument();
    await user.click(row);
    const detail = screen.getByRole("region", { name: "汉字读音 详情" });
    expect(within(detail).getByText("选项 2")).toBeInTheDocument();
    await user.click(row);
    expect(screen.queryByRole("region", { name: "汉字读音 详情" })).not.toBeInTheDocument();
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
