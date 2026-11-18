import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "../../test/mocks/server";
import { renderRoutes } from "../../test/render";
import { authStore } from "../auth/authStore";
import MockResultsRoute from "../../routes/study.mock.$sessionId.results";
import { MockRecords } from "./MockRecords";

const MockRecordsHost = () => <MockRecords examId="E-1" />;

const USER = { id: "u1", email: "a@example.com", username: null, display_name: "小明",
               current_level: "N2" as const, avatar: null };
const rt = (text: string) => ({
  format: "jlptgo-richtext-v1" as const,
  blocks: [{ type: "paragraph" as const,
    children: [{ type: "text" as const, text }] }],
});
const question = (id: string, pos: number) => ({
  id, question_type_id: "t", position: pos, printed_number: String(pos),
  prompt: rt(`题干 ${id}`), slot_id: null, conversion_status: "complete",
  options: ["a", "b"].map((o, i) => ({ id: `${id}-${o}`, position: i + 1,
    content: rt(`${id} 选项 ${o}`) })),
});
const unit = (id: string, qs: ReturnType<typeof question>[]) => ({
  release_id: "r-1", id, layer_id: "ly", question_type_id: "t", kind: "single",
  position: 1, label: id, slot_ids: [], conversion_status: "complete" as const,
  materials: [], questions: qs,
});
const row = (unitId: string, su: string, up: number, q: string, subject: string,
             chosen: string | null, correct: string, ok: boolean | null) => ({
  unit_id: unitId, unit_position: up, question_id: q, question_position: 1,
  printed_number: "1", chosen_option_id: chosen, correct_option_id: correct,
  is_correct: ok, skipped: chosen === null, session_unit_id: su, phase_id: "p1",
  subject, question_type_label: "题型",
});
// q1 vocabulary correct · q2 grammar wrong · q3 reading skipped
const QS = [
  row("u-1", "su-1", 1, "q1", "vocabulary", "q1-b", "q1-b", true),
  row("u-2", "su-2", 2, "q2", "grammar", "q2-a", "q2-b", false),
  row("u-3", "su-3", 3, "q3", "reading", null, "q3-b", null),
];
const RESULTS = {
  session_id: "m-1", release_id: "r-1", exam_id: "E-1", exam_title: "2018年12月 N2",
  level: "N2", started_at: "2026-11-18T08:00:00+00:00",
  finished_at: "2026-11-18T10:05:00+00:00", duration_seconds: 7200,
  correct_count: 1, wrong_count: 1, skipped_count: 1, total_count: 3,
  answered_accuracy: 0.5, scoring_method: "mock_phases", scoring_version: "1",
  score_rate: 0.3333,
  phases: [{ phase_id: "p1", title: "言語知識", correct: 1, wrong: 1, skipped: 1,
             total: 3, answered_accuracy: 0.5 }],
  subjects: [
    { subject: "vocabulary", correct: 1, wrong: 0, skipped: 0, total: 1, answered_accuracy: 1 },
    { subject: "grammar", correct: 0, wrong: 1, skipped: 0, total: 1, answered_accuracy: 0 },
    { subject: "reading", correct: 0, wrong: 0, skipped: 1, total: 1, answered_accuracy: null },
  ],
  questions: QS,
};

beforeAll(() => server.listen());
afterEach(() => { server.resetHandlers(); authStore.clear(); window.sessionStorage.clear(); });
afterAll(() => server.close());

function setup() {
  const fb: string[] = [];
  server.use(
    http.get("*/api/mock-exams/m-1/results", () => HttpResponse.json(RESULTS)),
    ...["u-1", "u-2", "u-3"].map((u, i) =>
      http.get(`*/api/releases/r-1/units/${u}`, () =>
        HttpResponse.json(unit(u, [question(`q${i + 1}`, 1)])))),
    http.get("*/api/mock-exams/m-1/units/:su/feedback", ({ params }) => {
      fb.push(String(params.su));
      const q = QS.find((x) => x.session_unit_id === params.su)!;
      return HttpResponse.json({
        unit_id: q.unit_id, release_id: "r-1", feedback_mode: "end",
        questions: [{ question_id: q.question_id, position: 1, printed_number: "1",
          chosen_option_id: q.chosen_option_id, correct_option_id: q.correct_option_id,
          is_correct: q.is_correct, skipped: q.skipped,
          explanations: [{ kind: "analysis", language: "zh-CN",
                           content: rt(`解析 ${q.question_id}`) }] }],
        unit_explanations: [] });
    }),
  );
  return fb;
}
const mount = () => renderRoutes([{ path: "study", children: [
  { path: "exams", element: <p>exams</p> },
  { path: "mock/:sessionId/results", Component: MockResultsRoute }] }],
  "/study/mock/m-1/results");

describe("模考成绩页", () => {
  it("overview separates 已作答正确率 from 已答进度; no official score, no subject table", async () => {
    authStore.setSession("tok", USER);
    setup();
    mount();
    const summary = await screen.findByRole("region", { name: "成绩概览" });
    expect(within(summary).getByText("50%")).toBeInTheDocument();
    expect(within(summary).getByText("已作答正确率")).toBeInTheDocument();
    expect(within(summary).getByText(/已答 2 \/ 3 题；未答题不计入正确率/)).toBeInTheDocument();
    expect(within(summary).getByText(/2018年12月 N2 · N2/)).toBeInTheDocument();
    expect(within(summary).getByText(/用时 2 小时 0 分钟/)).toBeInTheDocument();
    expect(within(summary).getByText(/不等同于 JLPT 官方换算成绩/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("subject cards carry the stats; only the chosen subject's numbers show, default = first wrong", async () => {
    authStore.setSession("tok", USER);
    const fb = setup();
    mount();
    const tabs = await screen.findByRole("tablist", { name: "科目" });
    const [vocab, grammar, reading] = within(tabs).getAllByRole("tab");
    expect(vocab).toHaveTextContent("已答 1/1 · 答错 0 · 正确率 100%");
    expect(grammar).toHaveTextContent("已答 1/1 · 答错 1 · 正确率 0%");
    expect(reading).toHaveTextContent("已答 0/1 · 答错 0 · 正确率 —");
    expect(within(tabs).queryByRole("tab", { name: /听力/ })).not.toBeInTheDocument();
    expect(grammar).toHaveAttribute("aria-selected", "true");
    // filter defaults to 错误; only that one number is shown (original numbering kept)
    const nav = screen.getByRole("navigation", { name: "题号导航" });
    expect(within(nav).getAllByRole("button").map((b) => b.textContent)).toEqual(["2×"]);
    expect(await screen.findByText("解析 q2")).toBeInTheDocument();
    expect(fb).toEqual(["su-2"]);
    expect(screen.getByRole("radio", { name: /错误 1/ })).toBeChecked();
  });

  it("switching subject without wrong answers falls back to 全部; filters and pager stay in scope", async () => {
    authStore.setSession("tok", USER);
    setup();
    mount();
    const tabs = await screen.findByRole("tablist", { name: "科目" });
    await userEvent.click(within(tabs).getByRole("tab", { name: /读解/ }));
    const filters = screen.getByRole("radiogroup", { name: "回顾筛选" });
    expect(within(filters).getByLabelText(/全部 1/)).toBeChecked();
    expect(await screen.findByText("解析 q3")).toBeInTheDocument();
    expect(screen.getByText("未作答")).toBeInTheDocument();
    await userEvent.click(within(filters).getByLabelText(/正确 0/));
    expect(screen.getByText("这个范围内没有题目。")).toBeInTheDocument();
    await userEvent.click(within(tabs).getByRole("tab", { name: /文字词汇/ }));
    expect(within(filters).getByLabelText(/全部 1/)).toBeChecked();
    const nav = screen.getByRole("navigation", { name: "题号导航" });
    expect(within(nav).getAllByRole("button").map((b) => b.textContent)).toEqual(["1✓"]);
    expect(await screen.findByText("解析 q1")).toBeInTheDocument();
    // read-only history: no answer submission controls
    expect(screen.queryByRole("button", { name: /提交/ })).not.toBeInTheDocument();
  });

  it("navigation never scrolls the page (no scrollIntoView / scrollTo)", async () => {
    authStore.setSession("tok", USER);
    setup();
    const calls: string[] = [];
    const proto = Element.prototype as unknown as Record<string, unknown>;
    const saved = { si: proto.scrollIntoView, st: window.scrollTo };
    proto.scrollIntoView = () => { calls.push("scrollIntoView"); };
    window.scrollTo = (() => { calls.push("scrollTo"); }) as typeof window.scrollTo;
    try {
      mount();
      const tabs = await screen.findByRole("tablist", { name: "科目" });
      await userEvent.click(within(tabs).getByRole("tab", { name: /文字词汇/ }));
      expect(await screen.findByText("解析 q1")).toBeInTheDocument();
      await userEvent.click(within(screen.getByRole("radiogroup", { name: "回顾筛选" }))
        .getByLabelText(/全部/));
      await userEvent.click(within(tabs).getByRole("tab", { name: /读解/ }));
      expect(await screen.findByText("解析 q3")).toBeInTheDocument();
      expect(calls).toEqual([]);
    } finally {
      proto.scrollIntoView = saved.si;
      window.scrollTo = saved.st;
    }
  });

  it("remembers subject, filter and question across a reload of the page", async () => {
    authStore.setSession("tok", USER);
    setup();
    const first = mount();
    const tabs = await screen.findByRole("tablist", { name: "科目" });
    await userEvent.click(within(tabs).getByRole("tab", { name: /读解/ }));
    expect(await screen.findByText("解析 q3")).toBeInTheDocument();
    first.unmount();
    mount();
    expect(await screen.findByText("解析 q3")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /读解/ })).toHaveAttribute("aria-selected", "true");
  });

  it("links back to the exam and to history", async () => {
    authStore.setSession("tok", USER);
    setup();
    mount();
    await screen.findByRole("tablist", { name: "科目" });
    expect(screen.getByRole("link", { name: "返回试卷" }))
      .toHaveAttribute("href", "/study/exams/E-1");
    expect(screen.getByRole("link", { name: "练习历史" }))
      .toHaveAttribute("href", "/study/learning?tab=history");
  });
});

describe("试卷详情：历次模拟考试记录", () => {
  const items = [
    { session_id: "m-2", finished_at: "2026-11-18T10:05:00+00:00", correct: 60,
      wrong: 30, skipped: 10, total: 100, answered_accuracy: 0.6667 },
    { session_id: "m-1", finished_at: "2026-11-10T10:05:00+00:00", correct: 50,
      wrong: 40, skipped: 10, total: 100, answered_accuracy: 0.5556 },
  ];
  const host = () => renderRoutes([
    { path: "x", element: <MockRecordsHost /> }], "/x");

  it("lists every attempt separately and links to the shared result page", async () => {
    authStore.setSession("tok", USER);
    server.use(http.get("*/api/exams/E-1/mock-results", () =>
      HttpResponse.json({ exam_id: "E-1", items })));
    host();
    const list = await screen.findByRole("region", { name: "历次模拟考试记录" });
    const links = within(list).getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual(
      ["/study/mock/m-2/results", "/study/mock/m-1/results"]);
    expect(links[0]).toHaveTextContent("67%");
  });

  it("renders nothing without records or without login", async () => {
    server.use(http.get("*/api/exams/E-1/mock-results", () =>
      HttpResponse.json({ exam_id: "E-1", items: [] })));
    authStore.setSession("tok", USER);
    host();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole("region", { name: "历次模拟考试记录" })).not.toBeInTheDocument();
  });
});
