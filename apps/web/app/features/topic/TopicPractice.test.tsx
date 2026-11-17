import { beforeAll, afterAll, afterEach, describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "../../test/mocks/server";
import { renderRoutes } from "../../test/render";
import { TopicPracticeView } from "./TopicPractice";
import { authStore } from "../auth/authStore";

const TYPES = {
  level: "N2",
  types: [
    { question_type_id: "vocabulary_kanji_reading", subject: "vocabulary",
      label_zh: "汉字读音", label_ja: "漢字読み", unit_kind: "single",
      is_provisional: false, available_units: 30, available_questions: 30,
      new_units: 25 },
    { question_type_id: "vocabulary_usage", subject: "vocabulary",
      label_zh: "用法", label_ja: "用法", unit_kind: "single",
      is_provisional: false, available_units: 4, available_questions: 4,
      new_units: 4 },
    { question_type_id: "reading_short", subject: "reading",
      label_zh: "内容理解（短篇）", label_ja: "内容理解（短文）",
      unit_kind: "passage", is_provisional: false, available_units: 8,
      available_questions: 16, new_units: 8 },
  ],
};
const USER = { id: "u1", email: "a@example.com", display_name: "小明",
               current_level: "N2" as const, avatar: null };

const SESSION = {
  id: "s-new", mode: "practice", feedback_mode: "immediate",
  state: "in_progress", version: 1, created_at: "x", ended_at: null,
  config: { requested_units: [], topic: { kind: "topic", level: "N2",
    question_type_id: "vocabulary_kanji_reading", requested_count: 10 } },
  units: [],
};

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  authStore.clear();
  window.localStorage.clear();
});
afterAll(() => server.close());

function renderPage(url = "/study/practice") {
  return renderRoutes([
    { path: "study/practice", Component: TopicPracticeView },
    { path: "study/practice/:id", Component: () => <p>practice page</p> },
  ], url);
}

describe("TopicPracticeView", () => {
  it("asks guests to sign in (no level)", async () => {
    renderPage();
    expect(await screen.findByText(/请先登录，再选择备考等级和题型/)).toBeInTheDocument();
  });

  it("lists real types of the preselected subject with counts and nouns", async () => {
    authStore.setSession("tok", USER);
    server.use(http.get("*/api/topic-practice/types", ({ request }) => {
      expect(new URL(request.url).searchParams.get("level")).toBe("N2");
      return HttpResponse.json(TYPES);
    }));
    renderPage("/study/practice?subject=reading");
    expect(await screen.findByText("内容理解（短篇）")).toBeInTheDocument();
    expect(screen.getByText("共 8 篇 · 未练习 8 篇")).toBeInTheDocument();
    expect(screen.queryByText("汉字读音")).not.toBeInTheDocument();
  });

  it("starts a session with the chosen type/count/feedback and navigates", async () => {
    authStore.setSession("tok", USER);
    let body: unknown = null;
    server.use(
      http.get("*/api/topic-practice/types", () => HttpResponse.json(TYPES)),
      http.post("*/api/topic-practice/sessions", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(SESSION, { status: 201 });
      }));
    const user = userEvent.setup();
    renderPage("/study/practice?subject=vocabulary");
    await user.click(await screen.findByLabelText(/汉字读音/));
    const start = screen.getByRole("button", { name: "开始练习" });
    await user.click(screen.getByRole("radio", { name: /统一反馈/ }));
    await user.click(screen.getByRole("button", { name: "5" }));
    await user.click(start);
    expect(await screen.findByText("practice page")).toBeInTheDocument();
    expect(body).toEqual({ level: "N2", question_type_id: "vocabulary_kanji_reading",
      count: 5, feedback_mode: "end" });
  });

  it("blocks starting when the count exceeds what is available", async () => {
    authStore.setSession("tok", USER);
    server.use(http.get("*/api/topic-practice/types", () => HttpResponse.json(TYPES)));
    const user = userEvent.setup();
    renderPage("/study/practice?subject=vocabulary");
    await user.click(await screen.findByLabelText(/用法/));
    // default count is min(10, 4) = 4
    expect(screen.getByRole("spinbutton")).toHaveValue(4);
    await user.clear(screen.getByRole("spinbutton"));
    await user.type(screen.getByRole("spinbutton"), "9");
    expect(screen.getByRole("alert")).toHaveTextContent("当前最多可选 4 题");
    expect(screen.getByRole("button", { name: "开始练习" })).toBeDisabled();
  });

  it("never shows a conflict dialog: starting is always allowed and goes straight in", async () => {
    authStore.setSession("tok", USER);
    let posts = 0;
    server.use(
      // an unfinished practice exists — it must not matter at all
      http.get("*/api/practice/sessions/current", () => HttpResponse.json(SESSION)),
      http.get("*/api/topic-practice/types", () => HttpResponse.json(TYPES)),
      http.post("*/api/topic-practice/sessions", () => {
        posts += 1;
        return HttpResponse.json({ ...SESSION, id: `s-new-${posts}` }, { status: 201 });
      }));
    const user = userEvent.setup();
    renderPage("/study/practice?subject=vocabulary");
    await user.click(await screen.findByLabelText(/汉字读音/));
    const start = screen.getByRole("button", { name: "开始练习" });
    expect(start).toBeEnabled();
    await user.click(start);
    expect(await screen.findByText("practice page")).toBeInTheDocument();
    expect(posts).toBe(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("a failed start shows the error normally, with no conflict flow", async () => {
    authStore.setSession("tok", USER);
    server.use(
      http.get("*/api/topic-practice/types", () => HttpResponse.json(TYPES)),
      http.post("*/api/topic-practice/sessions", () =>
        HttpResponse.json({ detail: { code: "no_candidates", message: "没有可练习的题" } },
                          { status: 422 })));
    const user = userEvent.setup();
    renderPage("/study/practice?subject=vocabulary");
    await user.click(await screen.findByLabelText(/汉字读音/));
    await user.click(screen.getByRole("button", { name: "开始练习" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("无法开始练习");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "开始练习" })).toBeEnabled();
  });

  it("shows an alert when the catalog fails to load", async () => {
    authStore.setSession("tok", USER);
    server.use(http.get("*/api/topic-practice/types", () =>
      HttpResponse.json({ detail: "boom" }, { status: 500 })));
    renderPage();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
