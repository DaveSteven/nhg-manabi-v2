import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "../../test/mocks/server";
import { renderRoutes } from "../../test/render";
import { authStore } from "../auth/authStore";
import { MockExamPage } from "./MockExam";
import { MockIntro } from "./MockIntro";

const USER = { id: "u1", email: "a@example.com", display_name: "小明",
               current_level: "N2" as const, avatar: null };
const rt = (text: string) => ({
  format: "jlptgo-richtext-v1" as const,
  blocks: [{ type: "paragraph" as const, children: [{ type: "text" as const, text }] }],
});
const question = (id: string, pos: number, n: string) => ({
  id, question_type_id: "t", position: pos, printed_number: n,
  prompt: rt(`题干 ${id}`), slot_id: null, conversion_status: "complete",
  options: ["a", "b"].map((o, i) => ({ id: `${id}-${o}`, position: i + 1,
    content: rt(`${id}-${o} 选项`) })),
});
const unit = (id: string, suId: string, layer: { id: string; label: string },
              qs: ReturnType<typeof question>[]) => ({
  release_id: "r-1", id, layer_id: layer.id, question_type_id: "t", kind: "single",
  position: 1, label: null, slot_ids: [], conversion_status: "complete" as const,
  materials: [], questions: qs, session_unit_id: suId, session_unit_state: "pending",
  audio: [] as unknown[],
  layer: { layer_id: layer.id, label: layer.label, position: 1, subject: "vocabulary",
           section_title: "文字・語彙" },
});
const L1 = { id: "ly1", label: "問題1" };
const L2 = { id: "ly2", label: "問題2" };
const CONTENT = {
  phase_id: "p1",
  units: [unit("u1", "su1", L1, [question("q1", 1, "1"), question("q2", 2, "2")]),
          unit("u2", "su2", L2, [question("q3", 1, "3")])],
};

const state = (over: Record<string, unknown> = {}) => ({
  id: "m-1", mode: "mock", state: "in_progress", exam_id: "E-1", exam_title: "2018年12月 N2",
  level: "N2", release_id: "r-1", created_at: "x", ended_at: null,
  server_now: new Date().toISOString(), active_phase_id: "p1", results_available: false,
  phases: [
    { phase_id: "p1", position: 1, title: "言語知識", duration_seconds: 6300,
      playback_policy: null, unit_count: 2, status: "active",
      started_at: "x", expires_at: new Date(Date.now() + 5400_000).toISOString(),
      remaining_seconds: 5400 },
    { phase_id: "p2", position: 2, title: "聴解", duration_seconds: 3000,
      playback_policy: null, unit_count: 1, status: "upcoming", started_at: null,
      expires_at: null, remaining_seconds: null }],
  active_units: [
    { session_unit_id: "su1", unit_id: "u1", position: 1, state: "pending" },
    { session_unit_id: "su2", unit_id: "u2", position: 2, state: "pending" }],
  ...over,
});

beforeAll(() => server.listen());
afterEach(() => { server.resetHandlers(); authStore.clear(); window.localStorage.clear(); });
afterAll(() => server.close());

function renderExam() {
  return renderRoutes([
    { path: "mock/:id", Component: () => <MockExamPage sessionId="m-1" /> },
    { path: "study/mock/:id/results", Component: () => <p>results page</p> },
    { path: "login", Component: () => <p>login page</p> },
  ], "/mock/m-1");
}

function setup(opts: { drafts?: unknown[]; submit?: (body: any) => Response } = {}) {
  const spy = { drafts: [] as any[], submits: [] as any[] };
  server.use(
    http.get("*/api/mock-exams/m-1", () => HttpResponse.json(state())),
    http.get("*/api/mock-exams/m-1/content", () => HttpResponse.json(CONTENT)),
    http.get("*/api/mock-exams/m-1/drafts", () =>
      HttpResponse.json({ drafts: opts.drafts ?? [] })),
    http.put("*/api/mock-exams/m-1/units/:su/drafts", async ({ request, params }) => {
      const b = await request.json() as any;
      spy.drafts.push({ su: params.su, ...b });
      return HttpResponse.json({ session_unit_id: params.su, question_id: b.question_id,
        chosen_option_id: b.chosen_option_id, row_version: b.expected_row_version + 1 });
    }),
    http.post("*/api/mock-exams/m-1/phases/p1/submit", async ({ request }) => {
      spy.submits.push(await request.json());
      return HttpResponse.json({ ...state({ active_phase_id: "p2",
        phases: [{ ...state().phases[0], status: "closed" },
                 { ...state().phases[1], status: "active",
                   expires_at: new Date(Date.now() + 3000_000).toISOString() }],
        active_units: [] }), idempotent: false });
    }),
  );
  return spy;
}

describe("Exam Mode", () => {
  it("guests are sent to login", async () => {
    renderExam();
    expect(await screen.findByText("login page")).toBeInTheDocument();
  });

  it("shows the sticky status bar from real data: phase, big question, progress, server clock", async () => {
    authStore.setSession("tok", USER);
    setup({ drafts: [{ session_unit_id: "su1", unit_id: "u1", unit_position: 1,
      question_id: "q1", chosen_option_id: "q1-a", row_version: 2, updated_at: "x" }] });
    renderExam();
    expect(await screen.findByText("N2 模拟考试")).toBeInTheDocument();
    expect(screen.getByText("言語知識 · 問題1")).toBeInTheDocument();
    expect(screen.getByText("已答 1 / 3")).toBeInTheDocument();       // restored draft counts
    const clock = screen.getByRole("timer");
    // the first tick may land a frame later under load: wait, don't race it
    await waitFor(() => expect(clock.textContent).toMatch(/^1:29:\d\d$|^1:30:00$/)); // ≈ 90 min left
    // one-screen-many-questions for the whole 大題, and no verdict anywhere
    expect(screen.getByText("题干 q1")).toBeInTheDocument();
    expect(screen.getByText("题干 q2")).toBeInTheDocument();
    expect(screen.queryByText(/正确答案|解析|答对/)).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /q1-a/ })).toBeChecked();
  });

  it("choosing saves a draft against the MOCK endpoint (no judging)", async () => {
    authStore.setSession("tok", USER);
    const spy = setup();
    const user = userEvent.setup();
    renderExam();
    await user.click(await screen.findByRole("radio", { name: /q2-b/ }));
    await waitFor(() => expect(spy.drafts).toHaveLength(1), { timeout: 3000 });
    expect(spy.drafts[0]).toMatchObject({ su: "su1", question_id: "q2",
      chosen_option_id: "q2-b", expected_row_version: 0 });
    expect(await screen.findByText("已答 1 / 3")).toBeInTheDocument();
  });

  it("answer sheet: overlay with real 大題 groups, status, flag, jump closes it", async () => {
    authStore.setSession("tok", USER);
    setup();
    const user = userEvent.setup();
    renderExam();
    await user.click(await screen.findByRole("radio", { name: /q1-a/ }));
    await user.click(screen.getAllByRole("button", { name: /标记待检查/ })[1]!);  // flag q2
    await user.click(screen.getByRole("button", { name: "答题卡" }));
    const sheet = await screen.findByRole("dialog", { name: "答题卡" });
    const stat = (label: string) => within(sheet).getByText(label).previousSibling;
    expect(stat("已作答")).toHaveTextContent("1");
    expect(stat("未作答")).toHaveTextContent("2");
    expect(stat("标记待检查")).toHaveTextContent("1");
    expect(within(sheet).getByRole("button", { name: /^問題1 · \d+\/\d+$/ })).toHaveAttribute("aria-expanded", "true");
    expect(within(sheet).getByRole("button", { name: /^問題2 · \d+\/\d+$/ })).toHaveAttribute("aria-expanded", "false");
    expect(within(sheet).getByRole("button", { name: "問題1 第 1 题，已作答" })).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: /第 2 题，未作答，已标记/ })).toBeInTheDocument();
    // jump into the folded second group
    await user.click(within(sheet).getByRole("button", { name: /^問題2 · \d+\/\d+$/ }));
    await user.click(within(sheet).getByRole("button", { name: /問題2 第 3 题/ }));
    expect(await screen.findByRole("heading", { name: "問題2" })).toBeInTheDocument();
    expect(screen.getByText("题干 q3")).toBeInTheDocument();
    expect(sheet.closest(".sheet-root")).not.toHaveClass("is-open");
  });

  it("the status-bar clock actually runs (no freezing on re-render)", async () => {
    authStore.setSession("tok", USER);
    setup();
    renderExam();
    const clock = await screen.findByRole("timer");
    const first = clock.textContent;
    await waitFor(() => expect(screen.getByRole("timer").textContent).not.toBe(first),
                  { timeout: 3000 });
  });

  it("reopening the sheet expands only the group the user is on", async () => {
    authStore.setSession("tok", USER);
    setup();
    const user = userEvent.setup();
    renderExam();
    await user.click(await screen.findByRole("button", { name: "下一大题" }));
    await user.click(screen.getByRole("radio", { name: /q3-a/ }));      // now in 問題2
    await user.click(screen.getByRole("button", { name: "答题卡" }));
    const sheet = await screen.findByRole("dialog", { name: "答题卡" });
    expect(within(sheet).getByRole("button", { name: /^問題2 · \d+\/\d+$/ }))
      .toHaveAttribute("aria-expanded", "true");
    expect(within(sheet).getByRole("button", { name: /^問題1 · \d+\/\d+$/ }))
      .toHaveAttribute("aria-expanded", "false");
    expect(within(sheet).getByRole("button", { name: "問題2 第 3 题，已作答，当前题" }))
      .toHaveAttribute("aria-current", "true");
  });

  const mkPassage = (qtype: string, id: string, nq = 2,
    materials: unknown[] = [{ id: `${id}-m`, kind: "passage", role: "primary", language: "ja",
                              content: rt("本文"), asset_id: null }]) => ({
    ...unit(id, `su-${id}`, L1, Array.from({ length: nq }, (_, i) =>
      question(`${id}-q${i + 1}`, i + 1, `${i + 1}`))),
    question_type_id: qtype, kind: "passage", materials,
  });
  const renderUnits = async (units: unknown[]) => {
    authStore.setSession("tok", USER);
    setup();
    server.use(http.get("*/api/mock-exams/m-1/content", () =>
      HttpResponse.json({ phase_id: "p1", units })));
    renderExam();
    await screen.findByText("N2 模拟考试");
    return waitFor(() => {
      const l = document.querySelectorAll(".shared-material-layout");
      expect(l).toHaveLength(units.length);
      return l;
    });
  };

  it("layout follows the material, not the type name; always one question at a time", async () => {
    const layouts = await renderUnits([mkPassage("reading_short_set", "ua", 1)]);
    for (const l of layouts) {
      expect(l).toHaveAttribute("data-layout-mode", "shared-material");
      expect(l.querySelector(".panel-pager")).toBeNull();            // single question: no pager
    }
  });

  it("shows one material per page; multi-question units page questions then materials", async () => {
    authStore.setSession("tok", USER);
    setup();
    const units = [mkPassage("reading_long", "ub", 2), mkPassage("reading_long", "uc", 1)];
    server.use(http.get("*/api/mock-exams/m-1/content", () =>
      HttpResponse.json({ phase_id: "p1", units })));
    const user = userEvent.setup();
    renderExam();
    await screen.findByText("N2 模拟考试");
    await waitFor(() => expect(document.querySelectorAll(".shared-material-layout")).toHaveLength(1));
    const layout = document.querySelector(".shared-material-layout") as HTMLElement;
    expect(layout.closest(".exam-unit")).toHaveAttribute("data-unit-id", "ub");
    const pager = within(layout).getByRole("navigation", { name: "题目切换" });
    expect(pager).toHaveTextContent("第 1 题 · 1/2");
    expect(within(pager).getByRole("button", { name: /上一题/ })).toBeDisabled();
    await user.click(within(layout).getByRole("radio", { name: "ub-q1-a 选项" }));
    await user.click(within(pager).getByRole("button", { name: /下一题/ }));
    expect(document.querySelector('[data-question-id="ub-q2"]')).toHaveClass("is-active-question");
    expect(pager).toHaveTextContent("第 2 题 · 2/2");
    // last question: next becomes 下一篇
    await user.click(within(pager).getByRole("button", { name: /下一篇/ }));
    await waitFor(() => expect(document.querySelector(".exam-unit")).toHaveAttribute("data-unit-id", "uc"));
    // back: earlier answer and question are restored
    await user.click(screen.getByRole("button", { name: "上一篇" }));
    await waitFor(() => expect(document.querySelector(".exam-unit")).toHaveAttribute("data-unit-id", "ub"));
    expect(screen.getByRole("radio", { name: "ub-q1-a 选项" })).toBeChecked();
    expect(document.querySelector('[data-question-id="ub-q2"]')).toHaveClass("is-active-question");
  });

  it("answer sheet jump switches to the material and question", async () => {
    authStore.setSession("tok", USER);
    setup();
    const units = [mkPassage("reading_long", "ub", 1), mkPassage("reading_long", "uc", 2)];
    server.use(http.get("*/api/mock-exams/m-1/content", () =>
      HttpResponse.json({ phase_id: "p1", units })));
    const user = userEvent.setup();
    renderExam();
    await screen.findByText("N2 模拟考试");
    await user.click(await screen.findByRole("button", { name: "答题卡" }));
    const sheet = await screen.findByRole("dialog", { name: "答题卡" });
    await user.click(within(sheet).getByRole("button", { name: /第 2 题/ }));
    await waitFor(() => expect(document.querySelector(".exam-unit")).toHaveAttribute("data-unit-id", "uc"));
    expect(document.querySelector('[data-question-id="uc-q2"]')).toHaveClass("is-active-question");
  });

  it("image-only material (information search) splits too, with an in-page zoom viewer", async () => {
    const user = userEvent.setup();
    const [layout] = await renderUnits([mkPassage("reading_information_search", "uc", 2,
      [{ id: "uc-img", kind: "image", role: "primary", language: null, content: null,
         asset_id: "asset-1" }])]);
    expect(layout).toHaveClass("is-image-material");
    expect(layout!.querySelector(".reading-question-panel")).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "放大查看图片" }));
    const viewer = screen.getByRole("dialog", { name: "查看大图" });
    await user.click(within(viewer).getByRole("button", { name: "原始大小" }));
    expect(within(viewer).getByRole("img")).toHaveClass("is-actual");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "查看大图" })).not.toBeInTheDocument();
  });

  it("short options use a 2×2 grid; long reading options one per row", async () => {
    const longOpt = "伝えたい内容に応じて、異なる種類の言葉を使い分けたほうがいい。";
    const u = mkPassage("reading_short", "ud", 1);
    u.questions[0]!.options = u.questions[0]!.options.map((o) => ({ ...o, content: rt(longOpt) }));
    await renderUnits([u]);
    expect(document.querySelector(".exam-options")).not.toHaveClass("is-grid");
  });

  it("the exam bar can abandon the exam after confirmation", async () => {
    authStore.setSession("tok", USER);
    setup();
    let abandoned = false;
    server.use(http.post("*/api/mock-exams/m-1/abandon", () => {
      abandoned = true;
      return HttpResponse.json(state({ state: "abandoned" }));
    }));
    const user = userEvent.setup();
    renderExam();
    await user.click(await screen.findByRole("button", { name: "放弃考试" }));
    const dlg = await screen.findByRole("dialog", { name: "放弃考试" });
    await user.click(within(dlg).getByRole("button", { name: "继续考试" }));
    expect(abandoned).toBe(false);
    await user.click(screen.getByRole("button", { name: "放弃考试" }));
    await user.click(within(await screen.findByRole("dialog", { name: "放弃考试" }))
      .getByRole("button", { name: "放弃考试" }));
    await waitFor(() => expect(abandoned).toBe(true));
  });

  it("answer sheet groups show the question type", async () => {
    authStore.setSession("tok", USER);
    setup();
    const base = unit("ux", "su-x", L1, [question("ux-q1", 1, "1")]) as any;
    base.layer.question_type_label = "汉字读音";
    server.use(http.get("*/api/mock-exams/m-1/content", () =>
      HttpResponse.json({ phase_id: "p1", units: [base] })));
    const user = userEvent.setup();
    renderExam();
    await user.click(await screen.findByRole("button", { name: "答题卡" }));
    const sheet = await screen.findByRole("dialog", { name: "答题卡" });
    expect(within(sheet).getByText("汉字读音")).toBeInTheDocument();
  });

  it("Escape closes the sheet", async () => {
    authStore.setSession("tok", USER);
    setup();
    const user = userEvent.setup();
    renderExam();
    await user.click(await screen.findByRole("button", { name: "答题卡" }));
    expect(document.querySelector(".sheet-root")).toHaveClass("is-open");
    await user.keyboard("{Escape}");
    expect(document.querySelector(".sheet-root")).not.toHaveClass("is-open");
  });

  it("hand-in: confirm shows counts, sends every answer, then the next phase takes over", async () => {
    authStore.setSession("tok", USER);
    const spy = setup();
    const user = userEvent.setup();
    renderExam();
    await user.click(await screen.findByRole("radio", { name: /q1-a/ }));
    await user.click(screen.getByRole("button", { name: "下一大题" }));
    await user.click(await screen.findByRole("button", { name: "结束当前阶段" }));
    const dlg = await screen.findByRole("dialog", { name: "确认结束本阶段" });
    expect(within(dlg).getByText("已作答").nextSibling).toHaveTextContent("1");
    expect(within(dlg).getByText("未作答").nextSibling).toHaveTextContent("2");
    await user.click(within(dlg).getByRole("button", { name: "返回检查" }));
    expect(spy.submits).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "结束当前阶段" }));
    await user.click(within(await screen.findByRole("dialog", { name: "确认结束本阶段" }))
      .getByRole("button", { name: "确认结束本阶段" }));
    await waitFor(() => expect(spy.submits).toHaveLength(1));
    expect(spy.submits[0].answers).toEqual([
      { session_unit_id: "su1", question_id: "q1", chosen_option_id: "q1-a" },
      { session_unit_id: "su1", question_id: "q2", chosen_option_id: null },
      { session_unit_id: "su2", question_id: "q3", chosen_option_id: null }]);
  });

  it("a failed draft save is stated, never shown as saved", async () => {
    authStore.setSession("tok", USER);
    setup();
    server.use(http.put("*/api/mock-exams/m-1/units/:su/drafts", () =>
      HttpResponse.json({ detail: "boom" }, { status: 500 })));
    const user = userEvent.setup();
    renderExam();
    await user.click(await screen.findByRole("radio", { name: /q1-a/ }));
    expect(await screen.findByText("答案保存失败，请检查网络", {}, { timeout: 3000 }))
      .toBeInTheDocument();
  });

  it("completed exam goes to the results page", async () => {
    authStore.setSession("tok", USER);
    server.use(http.get("*/api/mock-exams/m-1", () => HttpResponse.json(state({
      state: "completed", active_phase_id: null, results_available: true,
      phases: state().phases.map((p) => ({ ...p, status: "closed" })) }))));
    renderExam();
    expect(await screen.findByText("results page")).toBeInTheDocument();
  });
});

describe("Mock intro", () => {
  const AVAIL = { available: true, reason: null, exam_id: "E-1", title: "2018年12月 N2",
    level: "N2", total_seconds: 9300, phases: [
      { phase_id: "p1", position: 1, title: "言語知識", duration_seconds: 6300,
        playback_policy: null, unit_count: 2, question_count: 40 },
      { phase_id: "p2", position: 2, title: "聴解", duration_seconds: 3000,
        playback_policy: null, unit_count: 1, question_count: 30 }] };

  function renderIntro() {
    return renderRoutes([
      { path: "study/exams/:examId/mock", Component: () => <MockIntro examId="E-1" /> },
      { path: "mock/:id", Component: () => <p>exam page</p> },
      { path: "login", Component: () => <p>login page</p> },
    ], "/study/exams/E-1/mock");
  }

  it("lists the real phases and total, then starts the exam", async () => {
    authStore.setSession("tok", USER);
    let body: unknown = null;
    server.use(
      http.get("*/api/exams/E-1/mock", () => HttpResponse.json(AVAIL)),
      http.get("*/api/mock-exams/current", () =>
        HttpResponse.json({ detail: "no active mock exam" }, { status: 404 })),
      http.post("*/api/mock-exams", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(state(), { status: 201 });
      }));
    const user = userEvent.setup();
    renderIntro();
    expect(await screen.findByText("1. 言語知識")).toBeInTheDocument();
    expect(screen.getByText("105 分钟")).toBeInTheDocument();
    expect(screen.getByText("155 分钟")).toBeInTheDocument();          // total from data
    expect(screen.getByText("70 题")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "开始模拟考试" }));
    expect(await screen.findByText("exam page")).toBeInTheDocument();
    expect(body).toEqual({ exam_id: "E-1", replace_active: false });
  });

  it("an unavailable paper explains why and offers no start button", async () => {
    authStore.setSession("tok", USER);
    server.use(
      http.get("*/api/exams/E-1/mock", () => HttpResponse.json(
        { available: false, reason: "no_phases", exam_id: "E-1", title: "x", level: "N2", phases: [] })),
      http.get("*/api/mock-exams/current", () =>
        HttpResponse.json({ detail: "none" }, { status: 404 })));
    renderIntro();
    expect(await screen.findByText(/还没有考试阶段与时限数据/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "开始模拟考试" })).not.toBeInTheDocument();
  });

  it("a running mock can be continued or abandoned (never restarted from here)", async () => {
    authStore.setSession("tok", USER);
    let abandoned = false;
    const started: unknown[] = [];
    server.use(
      http.get("*/api/exams/E-1/mock", () => HttpResponse.json(AVAIL)),
      http.get("*/api/mock-exams/current", () => abandoned
        ? HttpResponse.json({ detail: "none" }, { status: 404 })
        : HttpResponse.json(state())),
      http.post("*/api/mock-exams/m-1/abandon", () => {
        abandoned = true;
        return HttpResponse.json(state({ state: "abandoned" }));
      }),
      http.post("*/api/mock-exams", async ({ request }) => {
        started.push(await request.json());
        return HttpResponse.json(state({ id: "m-2" }), { status: 201 });
      }));
    const user = userEvent.setup();
    renderIntro();
    expect(await screen.findByRole("link", { name: "继续模拟考试" }))
      .toHaveAttribute("href", "/mock/m-1");
    expect(screen.queryByRole("button", { name: "开始模拟考试" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "放弃考试" }));
    const dlg = await screen.findByRole("dialog", { name: "放弃考试" });
    expect(abandoned).toBe(false);                                    // nothing sent yet
    await user.click(within(dlg).getByRole("button", { name: "放弃考试" }));
    // abandoning does NOT start a new exam; the start button simply returns
    expect(await screen.findByRole("button", { name: "开始模拟考试" })).toBeInTheDocument();
    expect(abandoned).toBe(true);
    expect(started).toHaveLength(0);
  });
});
