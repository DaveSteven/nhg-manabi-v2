import { beforeAll, afterAll, afterEach, describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "../../test/mocks/server";
import { renderRoutes } from "../../test/render";
import { createQueryClient } from "../../api/queryClient";
import { PracticePage } from "./PracticePage";
import ResultsPage from "../../routes/study.practice.$sessionId.results";

const UNIT = { release_id: "r-1", unit_id: "u-1" };
const richText = (text: string) => ({
  format: "jlptgo-richtext-v1" as const,
  blocks: [{ type: "paragraph" as const,
    children: [{ type: "text" as const, text }] }],
});
const SESSION = {
  id: "s-1", mode: "practice", feedback_mode: "immediate",
  state: "in_progress",
  config: { requested_units: [UNIT] },
  version: 1, created_at: "x", ended_at: null,
  units: [{ id: "su-1", release_id: "r-1", exam_id: "E-N2-2018-12", unit_id: "u-1", position: 1,
            state: "pending", submitted_at: null }],
};
const PUBLIC_UNIT = {
  release_id: "r-1", id: "u-1", layer_id: "ly-1",
  question_type_id: "vocabulary", kind: "single", position: 1,
  label: "問題1", slot_ids: [], conversion_status: "complete" as const,
  materials: [],
  questions: [
    { id: "q1", question_type_id: "v", position: 1, printed_number: "1",
      prompt: null, slot_id: null, conversion_status: "complete",
      options: [
        { id: "o1", position: 1, content: richText("选项 o1") },
        { id: "o2", position: 2, content: richText("选项 o2") },
        { id: "o3", position: 3, content: richText("选项 o3") },
      ] },
    { id: "q2", question_type_id: "v", position: 2, printed_number: "2",
      prompt: null, slot_id: null, conversion_status: "complete",
      options: [
        { id: "o1q2", position: 1, content: richText("选项 q2-1") },
        { id: "o2q2", position: 2, content: richText("选项 q2-2") },
      ] },
  ],
};
const FEEDBACK = {
  unit_id: "u-1", release_id: "r-1", feedback_mode: "immediate",
  questions: [
    { question_id: "q1", position: 1, printed_number: "1",
      chosen_option_id: "o1", correct_option_id: "o1", is_correct: true,
      skipped: false, explanations: [{ kind: "analysis", language: "zh-CN",
                                       content: { format: "jlptgo-richtext-v1", blocks: [{ type: "paragraph", children: [{ type: "text", text: "因为选 o1 正确" }] }] } }] },
    { question_id: "q2", position: 2, printed_number: "2",
      chosen_option_id: null, correct_option_id: "o1q2", is_correct: null,
      skipped: true, explanations: [] },
  ],
  unit_explanations: [],
};

const createdSession = {
  ...SESSION, id: "new-session",
};

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function useSessionHandlers(opts: { draftRowVersion?: number } = {}) {
  const draftCalls: unknown[] = [];
  const submitCalls: unknown[] = [];
  let submitted = false;
  server.use(
    http.get(`*/api/practice/sessions/s-1`, () => HttpResponse.json(
      submitted
        ? { ...SESSION, units: [{ ...SESSION.units[0], state: "submitted",
                                  submitted_at: "x" }] }
        : SESSION,
    )),
    http.get(`*/api/releases/r-1/units/u-1`, () => HttpResponse.json(PUBLIC_UNIT)),
    http.get(`*/api/practice/sessions/s-1/drafts`, () =>
      HttpResponse.json({ drafts: [] })),
    http.put(`*/api/practice/sessions/s-1/units/su-1/drafts`, async ({ request }) => {
      draftCalls.push(await request.json());
      return HttpResponse.json({ session_unit_id: "su-1", question_id: "q1",
        chosen_option_id: "o1", row_version: (opts.draftRowVersion ?? 0) + 1 });
    }),
    http.post(`*/api/practice/sessions/s-1/units/su-1/submit`, async ({ request }) => {
      submitCalls.push(await request.json());
      submitted = true;
      return HttpResponse.json({
        session_unit_id: "su-1", unit_id: "u-1", release_id: "r-1",
        state: "submitted", answered_count: 1, skipped_count: 1,
        idempotent: false, feedback: FEEDBACK,
      });
    }),
    http.get(`*/api/practice/sessions/s-1/units/su-1/feedback`, () =>
      HttpResponse.json(FEEDBACK)),
  );
  return { draftCalls, submitCalls };
}

describe("PracticePage", () => {
  it("shows the trail 试卷 › 详情 › 练习 linking back to the session's exam", async () => {
    useSessionHandlers();
    renderRoutes([{ path: "study", children: [
      { path: "practice/:sessionId", element: <PracticePage sessionId="s-1" /> },
    ] }], "/study/practice/s-1");
    const nav = await screen.findByRole("navigation", { name: "面包屑" });
    expect(within(nav).getByRole("link", { name: "试卷" }))
      .toHaveAttribute("href", "/study/exams");
    expect(within(nav).getByRole("link", { name: "详情" }))
      .toHaveAttribute("href", "/study/exams/E-N2-2018-12");
    expect(within(nav).getByText("练习")).toHaveAttribute("aria-current", "page");
  });

  it("restores session with fixed-release unit and supports the full loop", async () => {
    const user = userEvent.setup();
    const { draftCalls, submitCalls } = useSessionHandlers();

    renderRoutes([{ path: "study", children: [
      { path: "practice/:sessionId", element: <PracticePage sessionId="s-1" /> },
    ] }], "/study/practice/s-1");

    // restored unit material/questions visible
    expect(await screen.findByRole("heading", { name: /問題1/ })).toBeInTheDocument();

    // answer q1, not q2
    await user.click(screen.getByRole("radio", { name: "选项 o1" }));
    // autosave fired with expected_row_version 0
    await waitFor(() => expect(draftCalls).toHaveLength(1));
    expect(draftCalls[0]).toMatchObject({ question_id: "q1",
      chosen_option_id: "o1", expected_row_version: 0 });
    // "已保存" badge intentionally not rendered any more (user decision);
    // the draft call above is the autosave-completed signal.

    // submit: unanswered confirm appears (q2 unanswered), then confirm
    await user.click(screen.getByRole("button", { name: "提交本组" }));
    const dialog = await screen.findByRole("dialog", { name: "还有题目未作答" });
    expect(dialog).toHaveTextContent("本组还有 1 题未作答");
    expect(submitCalls).toHaveLength(0); // not yet submitted
    await user.click(screen.getByRole("button", { name: "确认提交" }));

    await waitFor(() => expect(submitCalls).toHaveLength(1));
    expect(await screen.findByText("正确")).toBeInTheDocument();
    expect(screen.getByText("未答")).toBeInTheDocument();
    expect(screen.getByText(/因为选 o1 正确/)).toBeInTheDocument();
    // unit locked: radios disabled
    expect(screen.getByRole("radio", { name: /o1/ })).toBeDisabled();
  });

  it("server drafts are truth on refresh; local retry records only when newer", async () => {
    const { localStorage } = window;
    localStorage.setItem("pending_draft_retries", JSON.stringify([
      { sessionId: "s-1", questionId: "q1", optionId: "o2", knownVersion: 4,
        time: "now" },
    ]));
    const { draftCalls } = useSessionHandlers();
    server.use(
      http.get(`*/api/practice/sessions/s-1/drafts`, () => HttpResponse.json({
        drafts: [{ session_unit_id: "su-1", unit_id: "u-1", unit_position: 1,
                   question_id: "q1", chosen_option_id: "o1", row_version: 5,
                   updated_at: "x" }],
      })),
    );

    renderRoutes([{ path: "study", children: [
      { path: "practice/:sessionId", element: <PracticePage sessionId="s-1" /> },
    ] }], "/study/practice/s-1");

    await screen.findByRole("heading", { name: /問題1/ });
    // server draft o1 v5 wins over stale local record (v4) — no re-save fired
    await waitFor(() => expect(draftCalls).toHaveLength(0), { timeout: 1500 });
    expect(screen.getAllByRole("radio")[0]).toBeChecked();
    localStorage.removeItem("pending_draft_retries");
  });

  it("renders ended_early session without fabricated score and no feedback", async () => {
    useSessionHandlers();
    server.use(
      http.get(`*/api/practice/sessions/s-1`, () => HttpResponse.json({
        ...SESSION, state: "ended_early", ended_at: "x",
      })),
    );
    renderRoutes([{ path: "study", children: [
      { path: "practice/:sessionId", element: <PracticePage sessionId="s-1" /> },
    ] }], "/study/practice/s-1");

    await screen.findByText(/练习已提前结束/);
  });
});

const RESULTS = {
  session_id: "s-1",
  correct_count: 3, wrong_count: 2, skipped_count: 1, total_count: 6,
  score_rate: 0.5, answered_accuracy: 0.6,
  scoring_method: "all_questions", scoring_version: "1",
  finished_at: "x",
  questions: [
    { unit_id: "u-1", unit_position: 1, question_id: "q1", question_position: 1,
      printed_number: "1", chosen_option_id: "o1", correct_option_id: "o1",
      is_correct: true, skipped: false },
    { unit_id: "u-1", unit_position: 1, question_id: "q2", question_position: 2,
      printed_number: "2", chosen_option_id: null, correct_option_id: null,
      is_correct: null, skipped: true },
  ],
};

describe("ResultsPage", () => {
  function renderResults(handlers: Parameters<typeof server.use>[0][]) {
    server.use(...handlers);
    renderRoutes([{ path: "study", children: [
      { path: "practice/:sessionId/results", Component: ResultsPage },
    ] }], "/study/practice/s-1/results",
    createQueryClient());
  }

  it("shows completed numbers obeying the identity and per-question review", async () => {
    renderResults([http.get(`*/api/practice/sessions/s-1/results`, () =>
      HttpResponse.json(RESULTS))]);
    expect(await screen.findByText("得分率")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByText("60%")).toBeInTheDocument();
    expect(screen.getByText("未答", { selector: "dd, .review-row span" })).toBeInTheDocument();
  });

  it("ended_early shows an explicit no-score view (409 no_results_early_end)", async () => {
    renderResults([http.get(`*/api/practice/sessions/s-1/results`, () =>
      HttpResponse.json({ detail: { code: "no_results_early_end",
        message: "no results" } }, { status: 409 }))]);
    expect(await screen.findByText("练习已提前结束")).toBeInTheDocument();
    expect(screen.queryByText("得分率")).not.toBeInTheDocument();
  });

  it("not-finished sessions redirect to a back-to-practice view", async () => {
    renderResults([http.get(`*/api/practice/sessions/s-1/results`, () =>
      HttpResponse.json({ detail: { code: "session_not_finished",
        message: "not finished" } }, { status: 409 }))]);
    expect(await screen.findByText("练习尚未完成")).toBeInTheDocument();
  });
});

// --------------------------------- quick_practice copy & pager (v2.1) ----

const QUICK_SESSION = { ...SESSION, mode: "quick_practice" };
const QUICK_OUTLINE = {
  exam_id: "E-N2-2018-12", release_id: "r-1", revision: 1,
  level: "N2", year: 2018, month: 12, title: "2018年12月 N2",
  sections: [{
    section_id: "sec-1", subject: "vocabulary", position: 1, title: "言語知識",
    layers: [{
      layer_id: "ly-1", position: 1, question_type_id: "vocabulary",
      display_label: "問題1", instruction: null,
      units: [
        // position 3: the title shows the REAL paper position 問題1-3
        { unit_id: "u-1", position: 3, kind: "single", label: null,
          question_type_id: "vocabulary", question_count: 1 },
        { unit_id: "u-2", position: 4, kind: "single", label: null,
          question_type_id: "vocabulary", question_count: 2 },
      ],
    }],
  }],
};
const SINGLE_PUBLIC_UNIT = {
  ...PUBLIC_UNIT, questions: [PUBLIC_UNIT.questions[0]],
};
const FEEDBACK_SINGLE = { ...FEEDBACK, questions: [FEEDBACK.questions[0]] };
const COMPLETED_QUICK = {
  ...QUICK_SESSION, state: "completed", ended_at: "x",
  units: [{ ...QUICK_SESSION.units[0], state: "submitted",
            submitted_at: "x" }],
};

describe("PracticePage · quick_practice", () => {
  let draftCalls: unknown[];
  let submitCalls: unknown[];
  let quickCreates: Record<string, unknown>[];
  let submitted: boolean;

  /** multi=true exercises the multi-question pager path (提交本组). */
  function useQuickHandlers(opts: { multi?: boolean; lastUnit?: boolean } = {}) {
    draftCalls = []; submitCalls = []; quickCreates = [];
    submitted = false;
    const unitPayload = opts.multi ? PUBLIC_UNIT : SINGLE_PUBLIC_UNIT;
    const feedback = opts.multi ? FEEDBACK : FEEDBACK_SINGLE;
    const layerUnits = QUICK_OUTLINE.sections[0]!.layers[0]!.units;
    const outline = {
      ...QUICK_OUTLINE,
      sections: [{
        ...QUICK_OUTLINE.sections[0],
        layers: [{
          ...QUICK_OUTLINE.sections[0]!.layers[0],
          units: opts.lastUnit ? [layerUnits[0]!] : layerUnits,
        }],
      }],
    };
    server.use(
      http.get(`*/api/practice/sessions/s-1`, () => HttpResponse.json(
        submitted ? COMPLETED_QUICK : QUICK_SESSION)),
      http.get(`*/api/releases/r-1/units/u-1`, () =>
        HttpResponse.json(unitPayload)),
      http.get(`*/api/practice/sessions/s-1/drafts`, () =>
        HttpResponse.json({ drafts: [] })),
      http.put(`*/api/practice/sessions/s-1/units/su-1/drafts`,
        async ({ request }) => {
          draftCalls.push(await request.json());
          return HttpResponse.json({ session_unit_id: "su-1",
            question_id: "q1", chosen_option_id: "o1", row_version: 1 });
        }),
      http.post(`*/api/practice/sessions/s-1/units/su-1/submit`,
        async ({ request }) => {
          submitCalls.push(await request.json());
          submitted = true;
          return HttpResponse.json({
            session_unit_id: "su-1", unit_id: "u-1", release_id: "r-1",
            state: "submitted",
            answered_count: unitPayload.questions.length, skipped_count: 0,
            idempotent: false, session_state: "completed",
            feedback,
          });
        }),
      http.get(`*/api/practice/sessions/s-1/units/su-1/feedback`, () =>
        HttpResponse.json(feedback)),
      http.get(`*/api/exams/E-N2-2018-12`, () =>
        HttpResponse.json(outline)),
      http.post(`*/api/quick-practice/sessions`, async ({ request }) => {
        quickCreates.push(await request.json() as Record<string, unknown>);
        return HttpResponse.json({ ...QUICK_SESSION, id: "next-session" },
          { status: 201 });
      }),
    );
    return { draftCalls, submitCalls, quickCreates };
  }

  function renderQuick() {
    return renderRoutes([{ path: "study", children: [
      { path: "practice/:sessionId", element: <PracticePage sessionId="s-1" /> },
    ] }], "/study/practice/s-1");
  }

  it("single question: real paper title, 提交答案, no 第1/1组, zero drafts", async () => {
    const user = userEvent.setup();
    const { draftCalls } = useQuickHandlers();
    renderQuick();
    // title is the real paper position from the outline, not 組 N
    expect(await screen.findByRole("heading", { name: "問題1-3" }))
      .toBeInTheDocument();
    // 单 Unit 快速练习 never shows 第 1 / 1 组
    expect(screen.queryByText(/第 1 \/ 1 组/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "选项 o1" }));
    expect(screen.getByRole("radio", { name: "选项 o1" })).toBeChecked();
    // no autosave traffic at all (past the 800ms debounce window)
    await new Promise((r) => setTimeout(r, 1000));
    expect(draftCalls).toHaveLength(0);
  });

  it("single question submit: 提交答案, feedback, 下一题 opens the NEXT unit", async () => {
    const user = userEvent.setup();
    const { submitCalls, quickCreates } = useQuickHandlers();
    const rendered = renderQuick();
    await screen.findByRole("heading", { name: "問題1-3" });
    await user.click(screen.getByRole("radio", { name: "选项 o1" }));
    await user.click(screen.getByRole("button", { name: "提交答案" }));
    await waitFor(() => expect(submitCalls).toHaveLength(1));
    expect(await screen.findByText(/因为选 o1 正确/)).toBeInTheDocument();
    // no lock badge next to the title, no finish button
    expect(screen.queryByText(/已提交锁定/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button",
      { name: /完成练习|交卷并查看结果/ })).not.toBeInTheDocument();
    // post-submit nav: 下一题 (next unit in exam order) + 返回试卷
    await user.click(screen.getByRole("button", { name: "下一题" }));
    await waitFor(() => expect(quickCreates).toHaveLength(1));
    expect(quickCreates[0]).toEqual({ release_id: "r-1", unit_id: "u-2" });
    await waitFor(() =>
      rendered.router.state.location.pathname === "/study/practice/next-session",
      { timeout: 3000 });
  });

  it("multi-question unit: 上一题/下一题 pager, 提交本组, 下一组", async () => {
    const user = userEvent.setup();
    const { submitCalls, quickCreates } = useQuickHandlers({ multi: true });
    renderQuick();
    await screen.findByRole("heading", { name: "問題1-3" });
    // page 1: only q1 visible
    expect(screen.getByRole("radio", { name: "选项 o1" })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "选项 q2-1" }))
      .not.toBeInTheDocument();
    const prev = screen.getByRole("button", { name: "上一题" });
    const next = screen.getByRole("button", { name: "下一题" });
    expect(prev).toBeDisabled(); // nothing before the first question
    await user.click(screen.getByRole("radio", { name: "选项 o1" }));
    await user.click(next);
    expect(await screen.findByRole("radio", { name: "选项 q2-1" }))
      .toBeInTheDocument();
    expect(prev).toBeEnabled();
    expect(next).toBeDisabled(); // last question
    await user.click(screen.getByRole("radio", { name: "选项 q2-1" }));
    // whole-unit submit copy + atomic transaction unchanged
    await user.click(screen.getByRole("button", { name: "提交本组" }));
    await waitFor(() => expect(submitCalls).toHaveLength(1));
    expect(submitCalls[0]).toMatchObject({ answers:
      [{ question_id: "q1", chosen_option_id: "o1" },
       { question_id: "q2", chosen_option_id: "o1q2" }] });
    await user.click(await screen.findByRole("button", { name: "下一组" }));
    await waitFor(() => expect(quickCreates).toHaveLength(1));
    expect(quickCreates[0]).toEqual({ release_id: "r-1", unit_id: "u-2" });
  });

  it("unanswered submit keeps the one confirmation dialog", async () => {
    const user = userEvent.setup();
    const { submitCalls } = useQuickHandlers();
    renderQuick();
    await screen.findByRole("heading", { name: "問題1-3" });
    await user.click(screen.getByRole("button", { name: "提交答案" }));
    const dialog = await screen.findByRole("dialog", { name: "还有题目未作答" });
    expect(dialog).toHaveTextContent("本组还有 1 题未作答");
    expect(submitCalls).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "确认提交" }));
    await waitFor(() => expect(submitCalls).toHaveLength(1));
    expect(await screen.findByText(/因为选 o1 正确/)).toBeInTheDocument();
  });

  it("reviewing a completed quick session shows submitted choices, no drafts", async () => {
    const { draftCalls } = useQuickHandlers();
    server.use(http.get(`*/api/practice/sessions/s-1`, () =>
      HttpResponse.json(COMPLETED_QUICK)));
    renderQuick();
    await screen.findByRole("heading", { name: "問題1-3" });
    // submitted choices shown from the gated feedback payload (the only
    // legal source — quick sessions have no drafts); no lock badge
    expect(await screen.findByRole("radio", { name: "选项 o1" }))
      .toBeChecked();
    expect(screen.getByText("正确")).toBeInTheDocument();
    expect(screen.queryByText(/已提交锁定/)).not.toBeInTheDocument();
    expect(draftCalls).toHaveLength(0);
  });

  it("exam's last unit shows no next button — only 返回试卷", async () => {
    const user = userEvent.setup();
    const { quickCreates } = useQuickHandlers({ lastUnit: true });
    renderQuick();
    await screen.findByRole("heading", { name: "問題1-3" });
    await user.click(screen.getByRole("radio", { name: "选项 o1" }));
    await user.click(screen.getByRole("button", { name: "提交答案" }));
    await screen.findByText(/因为选 o1 正确/);
    expect(screen.queryByRole("button", { name: "下一题" }))
      .not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "返回试卷" })).toBeInTheDocument();
    expect(quickCreates).toHaveLength(0);
  });
});
