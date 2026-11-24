import { beforeAll, afterAll, afterEach, describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "../../test/mocks/server";
import { renderRoutes } from "../../test/render";
import { authStore } from "../auth/authStore";
import { PracticeBreadcrumb } from "../practice/PracticeBreadcrumb";
import { SupplementaryView, lessonStatus } from "./SupplementaryPractice";
import { lessonTitle } from "./lessonTitle";

const lesson = (n: number, extra = {}) => ({
  exam_id: `JLPTGO-SUP-N3-kanji-L${String(n).padStart(3, "0")}`, lesson: n,
  title: `漢字・第 ${n} 课`, question_count: 10, answered: 0, correct: 0, wrong: 0,
  ...extra,
});
const CATALOG = {
  level: "N3",
  subjects: [
    { subject: "kanji", label_zh: "汉字",
      lessons: [lesson(1), lesson(2, { answered: 10, correct: 8, wrong: 2 }),
                lesson(3, { answered: 4, correct: 4 })] },
    { subject: "grammar", label_zh: "语法",
      lessons: [{ ...lesson(1), exam_id: "JLPTGO-SUP-N3-grammar-L001",
                  title: "文法・第 1 课" }] },
  ],
};
const USER = { id: "u1", email: null, username: "old_user", display_name: "小明",
               current_level: "N3" as const, avatar: null };
const SESSION = {
  id: "s-new", mode: "practice", feedback_mode: "immediate", state: "in_progress",
  version: 1, created_at: "x", ended_at: null,
  config: { requested_units: [], supplementary: { kind: "supplementary",
    exam_id: "JLPTGO-SUP-N3-kanji-L003", level: "N3", subject: "kanji", lesson: 3 } },
  units: [],
};

beforeAll(() => server.listen());
afterEach(() => { server.resetHandlers(); authStore.clear(); window.localStorage.clear(); });
afterAll(() => server.close());

function renderPage(url = "/study/supplementary") {
  return renderRoutes([
    { path: "study/supplementary", Component: SupplementaryView },
    { path: "study/practice/:id", Component: () => <p>practice page</p> },
  ], url);
}

describe("lessonStatus / lessonTitle", () => {
  it("states progress from formal answers only", () => {
    expect(lessonStatus(lesson(1))).toBe("未练习");
    expect(lessonStatus(lesson(2, { answered: 4 }))).toBe("已做 4/10");
    expect(lessonStatus(lesson(2, { answered: 10, wrong: 2 }))).toBe("已做完 · 仍错 2");
    expect(lessonTitle(SESSION.config.supplementary as never)).toBe("扩展练习 · 汉字 第 3 课");
  });
});

describe("SupplementaryView", () => {
  it("asks guests to sign in", async () => {
    renderPage();
    expect(await screen.findByText(/请先登录，再选择备考等级/)).toBeInTheDocument();
  });

  it("lists the level's lessons of the first subject with progress", async () => {
    authStore.setSession("tok", USER);
    server.use(http.get("*/api/supplementary/lessons", ({ request }) => {
      expect(new URL(request.url).searchParams.get("level")).toBe("N3");
      return HttpResponse.json(CATALOG);
    }));
    renderPage();
    expect(await screen.findByRole("button", { name: "开始第 2 课" })).toBeInTheDocument();
    expect(screen.getByText("10 题 · 已做完 · 仍错 2")).toBeInTheDocument();
    expect(screen.getByText("10 题 · 已做 4/10")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /开始第 1 课/ })).toBeInTheDocument();
    // the other subject's lessons are on its own tab
    await userEvent.setup().click(screen.getByRole("tab", { name: "语法" }));
    expect(screen.getAllByRole("button", { name: /开始第/ })).toHaveLength(1);
  });

  it("starts a lesson with the chosen feedback mode and opens the practice", async () => {
    const user = userEvent.setup();
    authStore.setSession("tok", USER);
    let body: unknown = null;
    server.use(
      http.get("*/api/supplementary/lessons", () => HttpResponse.json(CATALOG)),
      http.post("*/api/supplementary/sessions", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(SESSION, { status: 201 });
      }));
    renderPage();
    await user.click(await screen.findByLabelText("统一反馈（结束后总结）"));
    await user.click(screen.getByRole("button", { name: "开始第 3 课" }));
    expect(await screen.findByText("practice page")).toBeInTheDocument();
    expect(body).toEqual({ exam_id: "JLPTGO-SUP-N3-kanji-L003", feedback_mode: "end" });
  });

  it("explains an unavailable lesson instead of failing silently", async () => {
    const user = userEvent.setup();
    authStore.setSession("tok", USER);
    server.use(
      http.get("*/api/supplementary/lessons", () => HttpResponse.json(CATALOG)),
      http.post("*/api/supplementary/sessions", () => HttpResponse.json(
        { detail: { code: "lesson_not_found", message: "x" } }, { status: 404 })));
    renderPage();
    await user.click(await screen.findByRole("button", { name: "开始第 1 课" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("这一课暂时不可用");
  });

  it("says so when the level has no supplementary lessons", async () => {
    authStore.setSession("tok", USER);
    server.use(http.get("*/api/supplementary/lessons",
      () => HttpResponse.json({ level: "N3", subjects: [] })));
    renderPage();
    expect(await screen.findByText("暂无 N3 的扩展练习。")).toBeInTheDocument();
  });
});

describe("PracticeBreadcrumb for a lesson", () => {
  it("links back to 扩展练习, not to an exam", () => {
    renderRoutes([{ path: "x", Component: () => (
      <PracticeBreadcrumb current="结果" examId="JLPTGO-SUP-N3-kanji-L003" supplementary /> ) }], "/x");
    expect(screen.getByRole("link", { name: "扩展练习" }))
      .toHaveAttribute("href", "/study/supplementary");
    expect(screen.queryByRole("link", { name: "详情" })).not.toBeInTheDocument();
  });
});
