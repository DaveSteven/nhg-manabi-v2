import { beforeAll, afterAll, afterEach, describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { ORIGIN, server } from "../../test/mocks/server";
import { renderRoutes } from "../../test/render";
import StudyLayout from "../../routes/study";
import ExamDetailPage from "../../routes/study.exams.$examId";
import PracticeRoute from "../../routes/study.practice.$sessionId";

const outline = {
  exam_id: "E-N2-2018-12",
  release_id: "r-uuid-1",
  revision: 1,
  level: "N2",
  year: 2018,
  month: 12,
  title: "2018年12月 N2",
  sections: [
    {
      section_id: "sec-v", subject: "vocabulary", position: 1, title: "言語知識",
      layers: [
        {
          layer_id: "ly-v1", position: 1,
          question_type_id: "vocabulary_kanji_reading",
          display_label: "問題1", instruction: null,
          units: [
            { unit_id: "u-v1", position: 1, kind: "set", label: null,
              question_type_id: "vocabulary_kanji_reading", question_count: 5 },
          ],
        },
        {
          layer_id: "ly-v2", position: 2,
          question_type_id: "vocabulary_reading",
          display_label: "問題7", instruction: null,
          units: [
            { unit_id: "u-v2", position: 1, kind: "set",
              label: "文章語彙", question_type_id: "vocabulary_reading",
              question_count: 5 },
          ],
        },
      ],
    },
    {
      section_id: "sec-g", subject: "grammar", position: 2, title: "文法",
      layers: [
        {
          layer_id: "ly-g1", position: 1, question_type_id: "grammar_cloze",
          display_label: "問題9", instruction: null,
          units: [
            { unit_id: "u-g1", position: 1, kind: "cloze", label: null,
              question_type_id: "grammar_cloze", question_count: 5 },
          ],
        },
      ],
    },
  ],
};

const createdSession = {
  id: "new-session",
  mode: "practice",
  feedback_mode: "immediate",
  state: "in_progress",
  config: { requested_units: [{ release_id: "r-uuid-1", unit_id: "u-v1" }] },
  version: 1,
  created_at: "2026-11-16T00:00:00+00:00",
  ended_at: null,
  units: [{ id: "su-1", release_id: "r-uuid-1", exam_id: "E-N2-2018-12", unit_id: "u-v1", position: 1,
            state: "pending", submitted_at: null }],
  units_meta: [{ release_id: "r-uuid-1", unit_id: "u-v1", layer_id: "ly-v1",
                 question_type_id: "vocabulary_kanji_reading", exam_id: "E",
                 question_count: 5 }],
};

const { units_meta: _omitted, ...sessionBase } = createdSession;
const oldSession = { ...sessionBase, id: "old-session" };
const practiceUnit = {
  release_id: "r-uuid-1", id: "u-v1", layer_id: "ly-v1",
  question_type_id: "vocabulary_kanji_reading", kind: "single", position: 1,
  label: "問題1", slot_ids: [], conversion_status: "complete",
  materials: [], questions: [],
};

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/** resetHandlers wipes test-scoped overrides, so every test re-applies. */
function useOutlineHandler() {
  server.use(
    http.get(`*/api/exams/E-N2-2018-12`, () => HttpResponse.json(outline)),
    http.get(`*/api/practice/sessions/:sessionId`, ({ params }) =>
      HttpResponse.json(params.sessionId === "old-session"
        ? oldSession : sessionBase)),
    http.get(`*/api/releases/r-uuid-1/units/u-v1`, () =>
      HttpResponse.json(practiceUnit)),
    http.get(`*/api/practice/sessions/:sessionId/drafts`, () =>
      HttpResponse.json({ drafts: [] })),
  );
}

describe("ExamOutline", () => {
  function renderDetail() {
    return renderRoutes(
      [{ path: "study", Component: StudyLayout, children: [
        { path: "exams/:examId", Component: ExamDetailPage },
        { path: "practice/:sessionId", Component: PracticeRoute },
      ] }],
      "/study/exams/E-N2-2018-12",
    );
  }

  it("shows a text breadcrumb 试卷 > 详情 instead of a back link", async () => {
    useOutlineHandler();
    renderDetail();
    const nav = await screen.findByRole("navigation", { name: "面包屑" });
    // ancestor is a link back to the list; the current page is plain text
    expect(within(nav).getByRole("link", { name: "试卷" }))
      .toHaveAttribute("href", "/study/exams");
    const current = within(nav).getByText("详情");
    expect(current).toHaveAttribute("aria-current", "page");
    expect(within(nav).queryByRole("link", { name: "详情" })).not.toBeInTheDocument();
    expect(screen.queryByText("返回试卷列表")).not.toBeInTheDocument();
  });

  it("layers and units are standard capsule cards", async () => {
    const user = userEvent.setup();
    useOutlineHandler();
    renderDetail();
    const toggle = await screen.findByRole("button", { name: /問題1/ });
    expect(toggle).toHaveClass("capsule-card");
    await user.click(toggle);
    const rows = document.querySelectorAll(".unit-row");
    expect(rows.length).toBeGreaterThan(0);
    rows.forEach((r) => expect(r).toHaveClass("capsule-card"));
    // the start action lives inside the unit capsule
    expect(within(rows[0] as HTMLElement).getByRole("button", { name: "开始练习" }))
      .toBeInTheDocument();
  });

  it("renders section tabs in server order and switches panels", async () => {
    const user = userEvent.setup();
    useOutlineHandler();
    renderDetail();
    const tablist = await screen.findByRole("tablist", { name: "学科大题" });
    expect(tablist).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "文字词汇" }))
      .toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "文法" })).toBeInTheDocument();
    // first section visible, second not yet
    expect(screen.getByRole("button", { name: /問題1/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /問題9/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "文法" }));
    expect(screen.getByRole("tab", { name: "文法" }))
      .toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: /問題9/ })).toBeInTheDocument();
  });

  it("expands layers and starts a single-unit practice with the outline release", async () => {
    const user = userEvent.setup();
    useOutlineHandler();
    const created: Record<string, unknown>[] = [];
    server.use(http.post(`*/api/practice/sessions`, async ({ request }) => {
      created.push(await request.json() as Record<string, unknown>);
      return HttpResponse.json(createdSession, { status: 201 });
    }));

    renderDetail();
    const toggle = await screen.findByRole("button", { name: /問題1/ });
    await user.click(toggle); // expand layer
    const start = screen.getByRole("button", { name: "开始练习" });
    await user.click(start);

    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      feedback_mode: "immediate",
      units: [{ release_id: "r-uuid-1", unit_id: "u-v1" }],
    });
    // navigated to the practice page for the new session
    expect(await screen.findByRole("heading", { name: /练习/ })).toBeInTheDocument();
  });

  it("shows the continue/end conflict dialog on 409 active_session_exists", async () => {
    const user = userEvent.setup();
    useOutlineHandler();
    server.use(http.post(`*/api/practice/sessions`, () =>
      HttpResponse.json({
        detail: { code: "active_session_exists",
                  message: "an active practice session already exists",
                  active_session_id: "old-session" },
      }, { status: 409 })));

    renderDetail();
    await user.click(await screen.findByRole("button", { name: /問題1/ }));
    await user.click(screen.getByRole("button", { name: "开始练习" }));

    const dialog = await screen.findByRole("dialog",
      { name: "已有进行中的练习" });
    expect(dialog).toBeInTheDocument();
    // No silent replacement: no new session was created beyond the 409.
    expect(screen.getByRole("button", { name: "继续旧练习" })).toBeInTheDocument();

    // 继续旧练习 → navigates to the OLD session page
    await user.click(screen.getByRole("button", { name: "继续旧练习" }));
    expect(await screen.findByRole("heading", { name: /练习/ })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "试卷详情" }))
      .not.toBeInTheDocument();
    void oldSession;
  });

  it("end-old-then-start requires explicit confirmation of ended_early semantics", async () => {
    const user = userEvent.setup();
    useOutlineHandler();
    const finishes: string[] = [];
    let createCalls = 0;
    server.use(
      http.post(`*/api/practice/sessions`, () => {
        createCalls += 1;
        if (createCalls === 1) {
          return HttpResponse.json({
            detail: { code: "active_session_exists",
                      message: "conflict",
                      active_session_id: "old-session" },
          }, { status: 409 });
        }
        return HttpResponse.json(createdSession, { status: 201 });
      }),
      http.post(`*/api/practice/sessions/old-session/finish`, () => {
        finishes.push("old-session");
        return HttpResponse.json({
          ...oldSession, state: "ended_early", ended_at: "x", idempotent: false,
        });
      }),
    );

    const rendered = renderDetail();
    await user.click(await screen.findByRole("button", { name: /問題1/ }));
    await user.click(screen.getByRole("button", { name: "开始练习" }));
    await user.click(await screen.findByRole("button",
      { name: "结束旧练习后开始" }));

    // Confirmation dialog states the ended_early consequences first.
    expect(screen.getByText(/尚未正式提交的题目/)).toBeInTheDocument();
    expect(finishes).toHaveLength(0); // not finished until confirmed
    await user.click(screen.getByRole("button",
      { name: "确认结束并开始新练习" }));
    expect(finishes).toHaveLength(1);
    // Retried creation succeeded → navigated to the new session page.
    const nav = await waitFor(() =>
      rendered!.router.state.location.pathname === "/study/practice/new-session",
      { timeout: 3000 });
    expect(nav).toBe(true);
  });

  it("surfaces non-conflict creation errors without a dialog", async () => {
    const user = userEvent.setup();
    useOutlineHandler();
    server.use(http.post(`*/api/practice/sessions`, () =>
      HttpResponse.json({ detail: {
        code: "unit_not_available", message: "unit not available",
      } }, { status: 422 })));

    renderDetail();
    await user.click(await screen.findByRole("button", { name: /問題1/ }));
    await user.click(screen.getByRole("button", { name: "开始练习" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("开始练习失败");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
