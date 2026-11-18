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

const USER = { id: "u1", email: "a@example.com", display_name: "小明",
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
afterEach(() => { server.resetHandlers(); authStore.clear(); });
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
  it("overview shows raw accuracy, time and counts — no official score or pass/fail", async () => {
    authStore.setSession("tok", USER);
    setup();
    mount();
    const summary = await screen.findByRole("region", { name: "成绩概览" });
    expect(within(summary).getByText("50%")).toBeInTheDocument();
    expect(within(summary).getByText(/2018年12月 N2 · N2/)).toBeInTheDocument();
    expect(within(summary).getByText(/用时 2 小时 0 分钟/)).toBeInTheDocument();
    expect(within(summary).getByText(/不等同于 JLPT 官方换算成绩/)).toBeInTheDocument();
    expect(screen.queryByText(/合格(?!判)/)).not.toBeInTheDocument();
    const subj = screen.getByRole("region", { name: "科目表现" });
    expect(within(subj).getByRole("row", { name: /文法 0 1 0 0%/ })).toBeInTheDocument();
    expect(within(subj).getByRole("row", { name: /读解 0 0 1 —/ })).toBeInTheDocument();
  });

  it("review: grouped by subject, defaults to the first wrong question, filters narrow the strip", async () => {
    authStore.setSession("tok", USER);
    const fb = setup();
    mount();
    const nav = await screen.findByRole("navigation", { name: "题号导航" });
    for (const g of ["文字词汇", "文法", "读解"]) {
      expect(within(nav).getByRole("group", { name: g })).toBeInTheDocument();
    }
    expect(within(nav).queryByRole("group", { name: "听力" })).not.toBeInTheDocument();
    // first wrong = question 2 → its unit and explanation load via the mock endpoint
    expect(await screen.findByText("解析 q2")).toBeInTheDocument();
    expect(fb).toEqual(["su-2"]);
    expect(within(nav).getByRole("button", { name: "第 2 题（错误）" }))
      .toHaveAttribute("aria-current", "step");

    const filters = screen.getByRole("radiogroup", { name: "回顾筛选" });
    await userEvent.click(within(filters).getByLabelText(/未答/));
    expect(within(nav).getAllByRole("button")).toHaveLength(1);
    expect(await screen.findByText("解析 q3")).toBeInTheDocument();
    expect(screen.getByText("未作答")).toBeInTheDocument();
    await userEvent.click(within(filters).getByLabelText(/全部/));
    expect(within(nav).getAllByRole("button")).toHaveLength(3);
    // history is read-only: nothing to answer, only review controls
    expect(screen.queryByRole("button", { name: /提交/ })).not.toBeInTheDocument();
  });

  it("navigates to a clicked question and back to the exam", async () => {
    authStore.setSession("tok", USER);
    setup();
    mount();
    const nav = await screen.findByRole("navigation", { name: "题号导航" });
    await userEvent.click(within(nav).getByRole("button", { name: "第 1 题（正确）" }));
    expect(await screen.findByText("解析 q1")).toBeInTheDocument();
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
