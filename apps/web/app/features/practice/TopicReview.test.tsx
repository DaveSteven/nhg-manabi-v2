import { beforeAll, afterAll, afterEach, describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "../../test/mocks/server";
import { renderRoutes } from "../../test/render";
import ResultsRoute from "../../routes/study.practice.$sessionId.results";
import { PracticePage } from "./PracticePage";

const rt = (text: string) => ({
  format: "jlptgo-richtext-v1" as const,
  blocks: [{ type: "paragraph" as const,
    children: [{ type: "text" as const, text }] }],
});
const question = (id: string, pos: number, n: string) => ({
  id, question_type_id: "t", position: pos, printed_number: n, prompt: rt(`题干 ${id}`),
  slot_id: null, conversion_status: "complete",
  options: ["a", "b"].map((o, i) => ({ id: `${id}-${o}`, position: i + 1,
    content: rt(`${id} 选项 ${o}`) })),
});
const unit = (id: string, kind: string, label: string,
              qs: ReturnType<typeof question>[], material?: string) => ({
  release_id: "r-1", id, layer_id: "ly", question_type_id: "t", kind, position: 1,
  label, slot_ids: [], conversion_status: "complete" as const,
  materials: material ? [{ id: `${id}-m`, kind: "passage", role: "primary",
    language: "ja", content: rt(material), asset_id: null }] : [],
  questions: qs,
});
const U1 = unit("u-1", "passage", "読解A",
  [question("q1", 1, "1"), question("q2", 2, "2")], "共享材料正文");
const U2 = unit("u-2", "single", "独立題", [question("q3", 1, "3")]);

// q1 correct, q2 wrong (chose a, correct b), q3 skipped
const RESULT_QS = [
  { unit_id: "u-1", unit_position: 1, question_id: "q1", question_position: 1,
    printed_number: "1", chosen_option_id: "q1-b", correct_option_id: "q1-b",
    is_correct: true, skipped: false },
  { unit_id: "u-1", unit_position: 1, question_id: "q2", question_position: 2,
    printed_number: "2", chosen_option_id: "q2-a", correct_option_id: "q2-b",
    is_correct: false, skipped: false },
  { unit_id: "u-2", unit_position: 2, question_id: "q3", question_position: 1,
    printed_number: "3", chosen_option_id: null, correct_option_id: "q3-b",
    is_correct: null, skipped: true },
];

const session = (feedback = "end", topic = true) => ({
  id: "s-1", mode: "practice", feedback_mode: feedback, state: "completed",
  config: { requested_units: [],
    ...(topic ? { topic: { kind: "topic", level: "N2", question_type_id: "t",
                           requested_count: 3, selection: "smart" } } : {}) },
  version: 1, created_at: "x", ended_at: "y",
  units: [
    { id: "su-1", release_id: "r-1", exam_id: "E-1", unit_id: "u-1", position: 1,
      state: "submitted", submitted_at: "x" },
    { id: "su-2", release_id: "r-1", exam_id: "E-2", unit_id: "u-2", position: 2,
      state: "submitted", submitted_at: "x" },
  ],
});

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

interface Spy { results: number; feedback: string[]; started: any[] }

function setup(opts: { feedback?: string; qs?: typeof RESULT_QS; skipped?: number;
                       correct?: number; wrong?: number } = {}): Spy {
  const spy: Spy = { results: 0, feedback: [], started: [] };
  const qs = opts.qs ?? RESULT_QS;
  const correct = opts.correct ?? 1, wrong = opts.wrong ?? 1, skipped = opts.skipped ?? 1;
  server.use(
    http.get("*/api/practice/sessions/s-1", () =>
      HttpResponse.json(session(opts.feedback ?? "end"))),
    http.get("*/api/releases/r-1/units/u-1", () => HttpResponse.json(U1)),
    http.get("*/api/releases/r-1/units/u-2", () => HttpResponse.json(U2)),
    http.get("*/api/practice/sessions/s-1/drafts", () => HttpResponse.json({ drafts: [] })),
    http.get("*/api/practice/sessions/s-1/results", () => {
      spy.results += 1;
      return HttpResponse.json({
        session_id: "s-1", correct_count: correct, wrong_count: wrong,
        skipped_count: skipped, total_count: correct + wrong + skipped,
        score_rate: correct / (correct + wrong + skipped),
        answered_accuracy: correct + wrong === 0 ? null : correct / (correct + wrong),
        scoring_method: "m", scoring_version: "1", finished_at: "y", questions: qs });
    }),
    http.get("*/api/practice/sessions/s-1/units/:su/feedback", ({ params }) => {
      spy.feedback.push(String(params.su));
      const isU1 = params.su === "su-1";
      const rows = RESULT_QS.filter((q) => q.unit_id === (isU1 ? "u-1" : "u-2"));
      return HttpResponse.json({
        unit_id: isU1 ? "u-1" : "u-2", release_id: "r-1", feedback_mode: "end",
        questions: rows.map((q) => ({ question_id: q.question_id,
          position: q.question_position, printed_number: q.printed_number,
          chosen_option_id: q.chosen_option_id, correct_option_id: q.correct_option_id,
          is_correct: q.is_correct, skipped: q.skipped,
          explanations: [{ kind: "analysis", language: "zh-CN",
                           content: rt(`解析 ${q.question_id}`) }] })),
        unit_explanations: [],
      });
    }),
    http.post("*/api/topic-practice/sessions", async ({ request }) => {
      spy.started.push(await request.json());
      return HttpResponse.json({ ...session(), id: "s-2" }, { status: 201 });
    }),
  );
  return spy;
}

function mount(url = "/study/practice/s-1/results") {
  return renderRoutes([{ path: "study", children: [
    { path: "practice", element: <p>topic home</p> },
    { path: "practice/:sessionId", element: <PracticePage sessionId="s-1" /> },
    { path: "practice/:sessionId/results", Component: ResultsRoute },
  ] }], url);
}

describe("专项练习：结果与解析合并页", () => {
  it("shows one compact summary (正确率 on answered basis), no 得分率/逐题复盘/往返按钮", async () => {
    setup();
    mount();
    const summary = await screen.findByRole("region", { name: "成绩概览" });
    expect(within(summary).getByText("50%")).toBeInTheDocument(); // 1 / (1+1)
    expect(within(summary).getByText(/按已作答 2 题计算/)).toBeInTheDocument();
    expect(within(summary).getByText("正确")).toBeInTheDocument();
    expect(within(summary).getByText("错误")).toBeInTheDocument();
    expect(within(summary).getByText("未答")).toBeInTheDocument();
    expect(screen.queryByText("得分率")).not.toBeInTheDocument();
    expect(screen.queryByText("已作答正确率")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "逐题复盘" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "查看答案与解析" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "查看结果" })).not.toBeInTheDocument();
  });

  it("number strip keeps answering order with ✓/×/neutral states and defaults to the first wrong question", async () => {
    setup();
    mount();
    const strip = await screen.findByRole("navigation", { name: "题号导航" });
    const btns = within(strip).getAllByRole("button");
    expect(btns.map((b) => b.textContent)).toEqual(["1✓", "2×", "3"]);
    expect(btns[0]).toHaveClass("is-correct");
    expect(btns[1]).toHaveClass("is-wrong");
    expect(btns[2]).toHaveClass("is-skipped");
    expect(btns[1]).toHaveAttribute("aria-current", "step");
    // default = first wrong (q2): its prompt, shared material and explanation show
    expect(await screen.findByText("题干 q2")).toBeInTheDocument();
    expect(screen.queryByText("题干 q1")).not.toBeInTheDocument();
    expect(screen.getByText("共享材料正文")).toBeInTheDocument();
    expect(await screen.findByText("解析 q2")).toBeInTheDocument();
  });

  it("marks the user's answer and the correct answer distinctly", async () => {
    setup();
    mount();
    const wrongOpt = (await screen.findByText("q2 选项 a")).closest("li")!;
    const rightOpt = screen.getByText("q2 选项 b").closest("li")!;
    expect(wrongOpt).toHaveClass("is-chosen", "is-wrong");
    expect(within(wrongOpt).getByText("你的答案")).toBeInTheDocument();
    expect(rightOpt).toHaveClass("is-correct");
    expect(within(rightOpt).getByText("正确答案")).toBeInTheDocument();
    // read-only: no inputs to change the formal history
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });

  it("clicking a number switches the question without re-requesting results; same-unit switch keeps material", async () => {
    const spy = setup();
    const user = userEvent.setup();
    mount();
    await screen.findByText("题干 q2");
    const material = screen.getByText("共享材料正文");
    const strip = screen.getByRole("navigation", { name: "题号导航" });
    await user.click(within(strip).getByRole("button", { name: /^第 1 题/ }));
    expect(await screen.findByText("题干 q1")).toBeInTheDocument();
    expect(screen.getByText("共享材料正文")).toBe(material); // same node, not reloaded
    await user.click(within(strip).getByRole("button", { name: /^第 3 题/ }));
    expect(await screen.findByText("题干 q3")).toBeInTheDocument();
    expect(screen.queryByText("共享材料正文")).not.toBeInTheDocument();
    expect(screen.getByText("未作答")).toBeInTheDocument();
    expect(spy.results).toBe(1);
  });

  it("上一题/下一题 move across units", async () => {
    setup();
    const user = userEvent.setup();
    mount();
    await screen.findByText("题干 q2");
    await user.click(screen.getByRole("button", { name: /下一题/ }));
    expect(await screen.findByText("题干 q3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /下一题/ })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /上一题/ }));
    expect(await screen.findByText("题干 q2")).toBeInTheDocument();
  });

  it("without wrong answers it starts on the first question", async () => {
    const qs = RESULT_QS.map((q) => ({ ...q, chosen_option_id: q.correct_option_id,
      is_correct: true, skipped: false }));
    setup({ qs, correct: 3, wrong: 0, skipped: 0 });
    mount();
    expect(await screen.findByText("题干 q1")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("only two bottom actions: 再练一组 reuses the config, 返回专项练习 leaves", async () => {
    const spy = setup();
    const user = userEvent.setup();
    mount();
    const actions = await screen.findByRole("group", { name: "练习后操作" });
    expect(Array.from(actions.querySelectorAll("button, a")).map((e) => e.textContent))
      .toEqual(["再练一组", "返回专项练习"]);
    await user.click(within(actions).getByRole("button", { name: "再练一组" }));
    await screen.findByText("topic home").catch(() => undefined);
    expect(spy.started[0]).toMatchObject({ level: "N2", question_type_id: "t", count: 3 });
  });

  it("end-mode feedback is only requested after the results exist (page is gated by completed results)", async () => {
    const spy = setup();
    mount();
    await screen.findByText("解析 q2");
    expect(spy.feedback).toContain("su-1");
  });

  it("the old practice URL of a completed topic session redirects to the merged page", async () => {
    setup();
    mount("/study/practice/s-1");
    expect(await screen.findByRole("region", { name: "成绩概览" })).toBeInTheDocument();
  });

  it("uses the 专项练习 trail, never an exam 详情 crumb", async () => {
    setup();
    mount();
    const nav = await screen.findByRole("navigation", { name: "面包屑" });
    expect(within(nav).getByRole("link", { name: "专项练习" }))
      .toHaveAttribute("href", "/study/practice");
    expect(within(nav).queryByRole("link", { name: "详情" })).not.toBeInTheDocument();
  });

  it("再练一组 keeps 只复习最近仍错 and explains an exhausted pool", async () => {
    setup();
    server.use(
      http.get("*/api/practice/sessions/s-1", () => HttpResponse.json({
        ...session(), config: { requested_units: [], topic: { kind: "topic",
          level: "N2", question_type_id: "t", requested_count: 3,
          selection: "wrong_only" } } })),
      http.post("*/api/topic-practice/sessions", async () =>
        HttpResponse.json({ detail: { code: "no_wrong_units", message: "none" } },
                          { status: 422 })),
    );
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("button", { name: "再练一组" }));
    expect(await screen.findByRole("alert"))
      .toHaveTextContent("目前没有最近仍错的题了");
  });
});
