import { beforeAll, afterAll, afterEach, describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "../../test/mocks/server";
import { renderRoutes } from "../../test/render";
import { PracticePage } from "./PracticePage";

const rt = (text: string) => ({
  format: "jlptgo-richtext-v1" as const,
  blocks: [{ type: "paragraph" as const,
    children: [{ type: "text" as const, text }] }],
});
const question = (id: string, pos: number, n: string, opts: string[]) => ({
  id, question_type_id: "t", position: pos, printed_number: n, prompt: rt(`题干 ${id}`),
  slot_id: null, conversion_status: "complete",
  options: opts.map((o, i) => ({ id: `${id}-${o}`, position: i + 1, content: rt(`${id} 选项 ${o}`) })),
});
const unit = (id: string, kind: string, label: string, qs: ReturnType<typeof question>[],
              material?: string) => ({
  release_id: "r-1", id, layer_id: "ly", question_type_id: "t", kind, position: 1,
  label, slot_ids: [], conversion_status: "complete" as const,
  materials: material ? [{ id: `${id}-m`, kind: "passage", role: "primary",
    language: "ja", content: rt(material), asset_id: null }] : [],
  questions: qs,
});
const U1 = unit("u-1", "passage", "読解A", [
  question("q1", 1, "1", ["a", "b"]), question("q2", 2, "2", ["a", "b"])], "共享材料正文");
const U2 = unit("u-2", "single", "独立題", [question("q3", 1, "3", ["a", "b"])]);

const session = (state = "in_progress", unitState = "pending") => ({
  id: "s-1", mode: "practice", feedback_mode: "end", state,
  config: { requested_units: [{ release_id: "r-1", unit_id: "u-1" }, { release_id: "r-1", unit_id: "u-2" }],
            topic: { kind: "topic", level: "N2", question_type_id: "t", requested_count: 2 } },
  version: 1, created_at: "x", ended_at: state === "in_progress" ? null : "y",
  units: [
    { id: "su-1", release_id: "r-1", exam_id: "E-1", unit_id: "u-1", position: 1,
      state: unitState, submitted_at: unitState === "submitted" ? "x" : null },
    { id: "su-2", release_id: "r-1", exam_id: "E-2", unit_id: "u-2", position: 2,
      state: unitState, submitted_at: unitState === "submitted" ? "x" : null },
  ],
});

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

interface Spy { drafts: any[]; submits: any[]; feedbackCalls: string[] }

function setup(opts: { state?: string; serverDrafts?: any[]; submitStatus?: number } = {}): Spy {
  const spy: Spy = { drafts: [], submits: [], feedbackCalls: [] };
  const state = opts.state ?? "in_progress";
  const unitState = state === "completed" ? "submitted" : "pending";
  server.use(
    http.get("*/api/practice/sessions/s-1", () => HttpResponse.json(session(state, unitState))),
    http.get("*/api/releases/r-1/units/u-1", () => HttpResponse.json(U1)),
    http.get("*/api/releases/r-1/units/u-2", () => HttpResponse.json(U2)),
    http.get("*/api/practice/sessions/s-1/drafts", () =>
      HttpResponse.json({ drafts: opts.serverDrafts ?? [] })),
    http.put("*/api/practice/sessions/s-1/units/:su/drafts", async ({ request, params }) => {
      const b = await request.json() as any;
      spy.drafts.push({ su: params.su, ...b });
      return HttpResponse.json({ session_unit_id: params.su, question_id: b.question_id,
        chosen_option_id: b.chosen_option_id, row_version: b.expected_row_version + 1 });
    }),
    http.post("*/api/practice/sessions/s-1/submit", async ({ request }) => {
      spy.submits.push(await request.json());
      if (opts.submitStatus && opts.submitStatus >= 400) {
        return HttpResponse.json({ detail: { code: "invalid_option", message: "boom" } },
                                 { status: opts.submitStatus });
      }
      return HttpResponse.json({ ...session("completed", "submitted"), idempotent: false });
    }),
    http.get("*/api/practice/sessions/s-1/units/:su/feedback", ({ params }) => {
      spy.feedbackCalls.push(String(params.su));
      const isU1 = params.su === "su-1";
      return HttpResponse.json({
        unit_id: isU1 ? "u-1" : "u-2", release_id: "r-1", feedback_mode: "end",
        questions: (isU1 ? ["q1", "q2"] : ["q3"]).map((q, i) => ({
          question_id: q, position: i + 1, printed_number: String(i + 1),
          chosen_option_id: `${q}-a`, correct_option_id: `${q}-b`, is_correct: false,
          skipped: false, explanations: [{ kind: "analysis", language: "zh-CN", content: rt(`解析 ${q}`) }] })),
        unit_explanations: [],
      });
    }),
    http.get("*/api/practice/sessions/s-1/results", () => HttpResponse.json({ detail: "n/a" }, { status: 404 })),
  );
  return spy;
}

function mount() {
  return renderRoutes([{ path: "study", children: [
    { path: "practice/:sessionId", element: <PracticePage sessionId="s-1" /> },
    { path: "practice/:sessionId/results", element: <p>results page</p> },
    { path: "practice", element: <p>topic home</p> },
  ] }], "/study/practice/s-1");
}

describe("统一反馈 practice", () => {
  it("shows ALL questions of a unit on one page; 下一篇 moves between units — never 提交 — and never judges or asks for feedback", async () => {
    const spy = setup();
    const user = userEvent.setup();
    mount();
    expect(await screen.findByText(/第 1–2 \/ 3 题/)).toBeInTheDocument();
    expect(screen.getByText(/第 1–2 \/ 3 题/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^提交$/ })).not.toBeInTheDocument();
    expect(screen.getByText("共享材料正文")).toBeInTheDocument();
    // both questions of the unit are visible together, no per-question paging
    expect(screen.getByRole("radio", { name: "q1 选项 a" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "q2 选项 a" })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "q3 选项 a" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "上一题" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "q1 选项 a" }));
    await user.click(screen.getByRole("button", { name: "下一篇" }));
    expect(await screen.findByText(/第 3 \/ 3 题/)).toBeInTheDocument();
    expect(screen.getByText(/第 3 \/ 3 题/)).toBeInTheDocument();
    expect(screen.queryByText("共享材料正文")).not.toBeInTheDocument();

    expect(spy.submits).toHaveLength(0);
    expect(spy.feedbackCalls).toHaveLength(0);
    await waitFor(() => expect(spy.drafts).toHaveLength(1));
    expect(spy.drafts[0]).toMatchObject({ su: "su-1", question_id: "q1",
      chosen_option_id: "q1-a", expected_row_version: 0 });
  });

  it("answers stay editable: 上一题 and the number strip return to change a draft", async () => {
    const spy = setup();
    const user = userEvent.setup();
    mount();
    await screen.findByText(/第 1–2 \/ 3 题/);
    await user.click(screen.getByRole("radio", { name: "q1 选项 a" }));
    await user.click(screen.getByRole("button", { name: "下一篇" }));
    await user.click(screen.getByRole("radio", { name: "q3 选项 b" }));  // unit 2 draft
    await user.click(screen.getByRole("button", { name: "上一题" }));
    expect(screen.getByRole("radio", { name: "q1 选项 a" })).toBeChecked();
    await user.click(screen.getByRole("radio", { name: "q1 选项 b" }));  // change it
    await user.click(screen.getByRole("button", { name: /第 2 题/ }));    // jump via strip
    expect(await screen.findByText(/第 3 \/ 3 题/)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "q3 选项 b" })).toBeChecked();

    await waitFor(() => expect(spy.drafts.length).toBeGreaterThanOrEqual(2));
    const q3 = spy.drafts.find((d) => d.question_id === "q3");
    expect(q3).toMatchObject({ su: "su-2", chosen_option_id: "q3-b" });
    const q1Last = [...spy.drafts].reverse().find((d) => d.question_id === "q1");
    expect(q1Last).toMatchObject({ su: "su-1", chosen_option_id: "q1-b" });
    expect(spy.submits).toHaveLength(0);
  });

  it("last question shows 完成并提交练习; unanswered are confirmed once, then ONE whole-session submit", async () => {
    const spy = setup();
    const user = userEvent.setup();
    mount();
    await screen.findByText(/第 1–2 \/ 3 题/);
    await user.click(screen.getByRole("radio", { name: "q1 选项 b" }));
    await user.click(screen.getByRole("button", { name: /第 2 题/ }));
    expect(screen.queryByRole("button", { name: /^下一/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "完成并提交练习" }));
    const dialog = await screen.findByRole("dialog", { name: "还有题目未作答" });
    expect(dialog).toHaveTextContent("本次练习还有 2 题未作答");
    expect(spy.submits).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "确认提交" }));
    expect(await screen.findByText("results page")).toBeInTheDocument();
    expect(spy.submits).toHaveLength(1);
    expect(spy.submits[0].answers).toEqual([
      { session_unit_id: "su-1", question_id: "q1", chosen_option_id: "q1-b" },
      { session_unit_id: "su-1", question_id: "q2", chosen_option_id: null },
      { session_unit_id: "su-2", question_id: "q3", chosen_option_id: null },
    ]);
  });

  it("fully answered: submits directly with no confirmation", async () => {
    const spy = setup();
    const user = userEvent.setup();
    mount();
    await screen.findByText(/第 1–2 \/ 3 题/);
    await user.click(screen.getByRole("radio", { name: "q1 选项 a" }));
    await user.click(screen.getByRole("radio", { name: "q2 选项 b" }));
    await user.click(screen.getByRole("button", { name: "下一篇" }));
    await user.click(screen.getByRole("radio", { name: "q3 选项 a" }));
    await user.click(screen.getByRole("button", { name: "完成并提交练习" }));
    expect(await screen.findByText("results page")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(spy.submits[0].answers.map((a: any) => a.chosen_option_id))
      .toEqual(["q1-a", "q2-b", "q3-a"]);
  });

  it("refresh restores server drafts of every unit; a failed submit keeps answers and can retry", async () => {
    const spy = setup({
      serverDrafts: [
        { session_unit_id: "su-1", unit_id: "u-1", unit_position: 1, question_id: "q2",
          chosen_option_id: "q2-b", row_version: 2, updated_at: "x" },
        { session_unit_id: "su-2", unit_id: "u-2", unit_position: 2, question_id: "q3",
          chosen_option_id: "q3-a", row_version: 1, updated_at: "x" }],
      submitStatus: 422,
    });
    const user = userEvent.setup();
    mount();
    await screen.findByText(/第 1–2 \/ 3 题/);
    expect(await screen.findByRole("radio", { name: "q2 选项 b" })).toBeChecked();
    await user.click(screen.getByRole("button", { name: /第 2 题/ }));
    expect(await screen.findByRole("radio", { name: "q3 选项 a" })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "完成并提交练习" }));
    await user.click(await screen.findByRole("button", { name: "确认提交" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("提交失败");
    expect(screen.queryByText("results page")).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "q3 选项 a" })).toBeChecked();
    expect(spy.submits).toHaveLength(1);
  });

  it("an abandoned (replaced) session is a locked read-only view with a clear note", async () => {
    setup({ state: "abandoned" });
    mount();
    expect(await screen.findByText(/第 1–2 \/ 3 题/)).toBeInTheDocument();
    expect(screen.getByText(/已被新的专项练习取代/)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "q1 选项 a" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "完成并提交练习" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "查看结果" })).not.toBeInTheDocument();
  });

  it("a completed topic session redirects to the merged result + explanation page (ADR-0026)", async () => {
    setup({ state: "completed" });
    mount();
    expect(await screen.findByText("results page")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "查看结果" })).not.toBeInTheDocument();
  });
});
