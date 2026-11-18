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
    expect(clock.textContent).toMatch(/^1:29:5\d$|^1:30:00$/);          // ≈ 90 min left
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
    expect(within(sheet).getByText("已作答 1 · 未作答 2 · 标记 1")).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: /^問題1\s*\d+\/\d+$/ })).toHaveAttribute("aria-expanded", "true");
    expect(within(sheet).getByRole("button", { name: /^問題2\s*\d+\/\d+$/ })).toHaveAttribute("aria-expanded", "false");
    expect(within(sheet).getByRole("button", { name: "問題1 第 1 题，已作答" })).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: /第 2 题，未作答，已标记/ })).toBeInTheDocument();
    // jump into the folded second group
    await user.click(within(sheet).getByRole("button", { name: /^問題2\s*\d+\/\d+$/ }));
    await user.click(within(sheet).getByRole("button", { name: /問題2 第 3 题/ }));
    expect(await screen.findByRole("heading", { name: "問題2" })).toBeInTheDocument();
    expect(screen.getByText("题干 q3")).toBeInTheDocument();
    expect(sheet.closest(".sheet-root")).not.toHaveClass("is-open");
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

  it("a running mock is continued, or replaced only after explicit confirmation", async () => {
    authStore.setSession("tok", USER);
    const bodies: any[] = [];
    server.use(
      http.get("*/api/exams/E-1/mock", () => HttpResponse.json(AVAIL)),
      http.get("*/api/mock-exams/current", () => HttpResponse.json(state())),
      http.post("*/api/mock-exams", async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(state({ id: "m-2" }), { status: 201 });
      }));
    const user = userEvent.setup();
    renderIntro();
    expect(await screen.findByRole("link", { name: "继续模拟考试" }))
      .toHaveAttribute("href", "/mock/m-1");
    await user.click(screen.getByRole("button", { name: "放弃进行中的考试并重新开始" }));
    const dlg = await screen.findByRole("dialog", { name: "放弃进行中的考试" });
    expect(bodies).toHaveLength(0);                                   // nothing sent yet
    await user.click(within(dlg).getByRole("button", { name: "放弃并重新开始" }));
    expect(await screen.findByText("exam page")).toBeInTheDocument();
    expect(bodies).toEqual([{ exam_id: "E-1", replace_active: true }]);
  });
});
