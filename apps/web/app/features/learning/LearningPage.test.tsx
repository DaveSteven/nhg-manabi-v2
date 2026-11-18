import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "../../test/mocks/server";
import { renderRoutes } from "../../test/render";
import { authStore } from "../auth/authStore";
import { LearningView } from "./LearningPage";
import { formatPercent } from "./learningModel";

const USER = { id: "u1", email: "a@example.com", display_name: "小明",
               current_level: "N2" as const, avatar: null };

const EMPTY = {
  level: "N2",
  totals: { attempts: 0, correct: 0, wrong: 0, skipped: 0,
            answered_accuracy: null, practiced_questions: 0,
            still_wrong_questions: 0, completed_sessions: 0,
            last_practiced_at: null },
  coverage: { practiced_questions: 0, total_questions: 40, ratio: 0 },
  by_subject: [], weak_types: [],
};
const FILLED = {
  level: "N2",
  totals: { attempts: 20, correct: 15, wrong: 5, skipped: 2,
            answered_accuracy: 0.75, practiced_questions: 18,
            still_wrong_questions: 3, completed_sessions: 4,
            last_practiced_at: "2026-11-17T10:00:00+00:00" },
  coverage: { practiced_questions: 18, total_questions: 40, ratio: 0.45 },
  by_subject: [
    { subject: "grammar", practiced_questions: 10, total_questions: 20,
      attempts: 12, correct: 8, wrong: 4, accuracy: 0.6667, still_wrong: 2 },
    { subject: "reading", practiced_questions: 0, total_questions: 20,
      attempts: 0, correct: 0, wrong: 0, accuracy: null, still_wrong: 0 },
  ],
  weak_types: [
    { question_type_id: "grammar_cloze", subject: "grammar", label_zh: "文法填空",
      attempts: 12, wrong: 4, accuracy: 0.6667, low_sample: false, still_wrong: 2 },
    { question_type_id: "vocab_kanji", subject: "vocabulary", label_zh: "汉字读音",
      attempts: 3, wrong: 2, accuracy: 0.3333, low_sample: true, still_wrong: 2 }],
};
const RECORD = {
  question_id: "q1", exam_id: "e1", release_id: "r1", exam_title: "2018年12月 N2",
  level: "N2", year: 2018, month: 12, unit_id: "u-1", layer_label: "問題7",
  printed_number: "3", question_type_id: "grammar_cloze",
  question_type_label: "文法填空", subject: "grammar", attempt_count: 2,
  wrong_count: 1, last_result: "wrong", last_answered_at: "2026-11-17T10:00:00+00:00",
};
const SESSION = {
  id: "s-quick", mode: "quick_practice", feedback_mode: "immediate",
  state: "in_progress", version: 1, created_at: "x", ended_at: null,
  config: { requested_units: [] }, units: [],
};

beforeAll(() => server.listen());
afterEach(() => { server.resetHandlers(); authStore.clear(); window.localStorage.clear(); });
afterAll(() => server.close());

function renderPage(url = "/study/learning") {
  return renderRoutes([
    { path: "study/learning", Component: LearningView },
    { path: "study/practice/:id", Component: () => <p>practice page</p> },
    { path: "study/practice/:id/results", Component: () => <p>results page</p> },
    { path: "login", Component: () => <p>login page</p> },
  ], url);
}

describe("LearningView", () => {
  it("sends guests to the login page", async () => {
    renderPage();
    expect(await screen.findByText("login page")).toBeInTheDocument();
  });

  it("formats an empty denominator as — instead of 0%", () => {
    expect(formatPercent(null)).toBe("—");
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(0.6667)).toBe("67%");
  });

  it("overview: an empty account shows guidance, not fake zeros", async () => {
    authStore.setSession("tok", USER);
    server.use(http.get("*/api/me/learning/overview", ({ request }) => {
      expect(new URL(request.url).searchParams.get("level")).toBe("N2");
      return HttpResponse.json(EMPTY);
    }));
    renderPage();
    expect(await screen.findByText(/还没有 N2 的作答记录/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "去专项练习" }))
      .toHaveAttribute("href", "/study/practice");
  });

  it("overview: real numbers, — for unanswered subjects, weak types link out", async () => {
    authStore.setSession("tok", USER);
    server.use(http.get("*/api/me/learning/overview", () => HttpResponse.json(FILLED)));
    renderPage();
    expect(await screen.findByText("75%")).toBeInTheDocument();
    expect(screen.getByText("45%")).toBeInTheDocument();
    expect(screen.getByText("已练 18 / 共 40 道不同题目")).toBeInTheDocument();
    for (const l of ["已作答正确率", "题库覆盖率", "最近仍错", "练习次数"]) {
      expect(screen.getAllByText(l).length).toBeGreaterThan(0);
    }
    const subjects = screen.getByRole("region", { name: "按科目" });
    const reading = within(subjects).getByRole("link", { name: /读解/ });
    expect(within(reading).getByText("—")).toBeInTheDocument();
    expect(reading).toHaveAttribute("href", "/study/practice?subject=reading");
    const weak = screen.getByRole("region", { name: "薄弱题型" });
    expect(within(weak).getByText("文法填空")).toBeInTheDocument();
    const go = within(weak).getAllByRole("link", { name: "去练习" });
    expect(go[0]).toHaveAttribute("href", "/study/practice?type=grammar_cloze");
    // small sample is flagged, not judged; reliable one is not flagged
    expect(within(weak).getAllByText("数据较少")).toHaveLength(1);
  });

  it("overview: 建议先复习 shows the real count and links to the records tab", async () => {
    authStore.setSession("tok", USER);
    server.use(http.get("*/api/me/learning/overview", () => HttpResponse.json(FILLED)));
    renderPage();
    const banner = await screen.findByRole("link", { name: /建议先复习/ });
    expect(banner).toHaveTextContent("3 道最近仍错");
    expect(banner).toHaveAttribute("href", "/study/learning?tab=records");
  });

  it("overview: no 建议先复习 when nothing is still wrong", async () => {
    authStore.setSession("tok", USER);
    server.use(http.get("*/api/me/learning/overview", () => HttpResponse.json({
      ...FILLED, totals: { ...FILLED.totals, still_wrong_questions: 0 } })));
    renderPage();
    await screen.findByText("75%");
    expect(screen.queryByText(/建议先复习/)).not.toBeInTheDocument();
  });

  it("overview explains when samples are too small for weak types", async () => {
    authStore.setSession("tok", USER);
    server.use(http.get("*/api/me/learning/overview", () =>
      HttpResponse.json({ ...FILLED, weak_types: [] })));
    renderPage();
    expect(await screen.findByText(/暂无明显薄弱的题型/)).toBeInTheDocument();
  });

  it("history lists real sessions; results link only when a result exists", async () => {
    authStore.setSession("tok", USER);
    const base = { feedback_mode: "end", happened_at: "2026-11-17T10:00:00+00:00",
                   level: "N2", exam_id: "e1", skipped: 1, answered_accuracy: 0.5 };
    server.use(http.get("*/api/me/learning/history", () => HttpResponse.json({
      total: 2, items: [
        { ...base, session_id: "s-1", mode: "practice", state: "completed",
          source: { kind: "topic", label: "文法填空" }, correct: 1, wrong: 1,
          total: 3, has_result: true },
        { ...base, session_id: "s-2", mode: "practice", state: "ended_early",
          source: { kind: "exam", label: "2018年12月 N2" }, correct: 0, wrong: 1,
          total: 2, has_result: false }] })));
    renderPage("/study/learning?tab=history");
    expect(await screen.findByText("文法填空")).toBeInTheDocument();
    expect(screen.getByText("专项练习")).toBeInTheDocument();
    expect(screen.getByText(/提前结束/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "查看结果" })).not.toBeInTheDocument();
    // the whole row is the link; ended-early rows have no result page
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "/study/practice/s-1/results");
    expect(links[0]).toHaveTextContent("3 题");
    expect(links[0]).toHaveTextContent("50%");
  });

  it("records: filters follow strategy B and re-practice starts a quick session", async () => {
    authStore.setSession("tok", USER);
    const seen: string[] = [];
    let started: unknown = null;
    server.use(
      http.get("*/api/me/learning/questions", ({ request }) => {
        const u = new URL(request.url);
        seen.push(`${u.searchParams.get("filter")}|${u.searchParams.get("level")}`);
        return HttpResponse.json({ filter: u.searchParams.get("filter"),
          total: 1, items: [RECORD] });
      }),
      http.post("*/api/quick-practice/sessions", async ({ request }) => {
        started = await request.json();
        return HttpResponse.json(SESSION, { status: 201 });
      }));
    const user = userEvent.setup();
    renderPage("/study/learning?tab=records");
    expect(await screen.findByText("2018年12月 N2")).toBeInTheDocument();
    expect(screen.getByText("問題7 · 第 3 题")).toBeInTheDocument();
    expect(screen.getByText("文法填空")).toBeInTheDocument();
    expect(screen.getByText("最近答错")).toBeInTheDocument();
    expect(screen.getByText(/作答 2 次，答错 1 次/)).toBeInTheDocument();
    expect(seen[0]).toBe("still_wrong|N2");               // default: 最近仍错
    await user.click(screen.getByRole("radio", { name: "曾经答错" }));
    await screen.findByText("2018年12月 N2");
    expect(seen).toContain("ever_wrong|N2");
    await user.click(screen.getByRole("button", { name: "重新练习" }));
    expect(await screen.findByText("practice page")).toBeInTheDocument();
    expect(started).toEqual({ release_id: "r1", unit_id: "u-1" });
  });

  it("records: empty list is explained per filter", async () => {
    authStore.setSession("tok", USER);
    server.use(http.get("*/api/me/learning/questions", () =>
      HttpResponse.json({ filter: "still_wrong", total: 0, items: [] })));
    renderPage("/study/learning?tab=records");
    expect(await screen.findByText("目前没有最近仍错的题。")).toBeInTheDocument();
  });

  it("history paginates 10 per page with a total and page numbers", async () => {
    authStore.setSession("tok", USER);
    const calls: string[] = [];
    const mk = (n: number) => ({ feedback_mode: "end", happened_at: "2026-11-17T10:00:00+00:00",
      level: "N2", exam_id: "e1", skipped: 0, answered_accuracy: 1, session_id: `s-${n}`,
      mode: "practice", state: "completed", source: { kind: "exam", label: `试卷${n}` },
      correct: 1, wrong: 0, total: 1, has_result: true });
    server.use(http.get("*/api/me/learning/history", ({ request }) => {
      const u = new URL(request.url);
      calls.push(`${u.searchParams.get("limit")}@${u.searchParams.get("offset")}`);
      const off = Number(u.searchParams.get("offset"));
      return HttpResponse.json({ total: 25, items: [mk(off + 1)] });
    }));
    const user = userEvent.setup();
    renderPage("/study/learning?tab=history");
    expect(await screen.findByText("试卷1")).toBeInTheDocument();
    expect(screen.getByText("共 25 条")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "第 3 页" }));
    expect(await screen.findByText("试卷21")).toBeInTheDocument();
    expect(calls).toEqual(["10@0", "10@20"]);
  });

  it("shows an alert when a tab fails to load", async () => {
    authStore.setSession("tok", USER);
    server.use(http.get("*/api/me/learning/overview", () =>
      HttpResponse.json({ detail: "boom" }, { status: 500 })));
    renderPage();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
