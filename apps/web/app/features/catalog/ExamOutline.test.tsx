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
const oldSession = {
  ...sessionBase, id: "old-session",
  units: [{ id: "su-old", release_id: "r-uuid-1", exam_id: "E-N2-2018-12",
            unit_id: "u-v2", position: 1, state: "pending", submitted_at: null }],
};
const noActive = { detail: "no active practice" };
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
    http.get(`*/api/exams/E-N2-2018-12/practice-status`, () =>
      HttpResponse.json({ exam_id: "E-N2-2018-12", units: [] })),
    http.get(`*/api/practice/sessions/current`, () =>
      HttpResponse.json(noActive, { status: 404 })),
    http.get(`*/api/practice/sessions/:sessionId`, ({ params }) =>
      HttpResponse.json(params.sessionId === "old-session"
        ? oldSession : sessionBase)),
    http.get(`*/api/releases/r-uuid-1/units/u-v1`, () =>
      HttpResponse.json(practiceUnit)),
    http.get(`*/api/releases/r-uuid-1/units/u-v2`, () =>
      HttpResponse.json({ ...practiceUnit, id: "u-v2", label: "文章語彙" })),
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

  it("unit rows are whole-row buttons with count and chevron, no inner start button", async () => {
    const user = userEvent.setup();
    useOutlineHandler();
    renderDetail();
    const toggle = await screen.findByRole("button", { name: /問題1/ });
    expect(toggle).toHaveClass("capsule-card");
    await user.click(toggle);
    const rows = document.querySelectorAll("button.unit-row");
    expect(rows.length).toBeGreaterThan(0);
    rows.forEach((r) => expect(r).toHaveClass("capsule-card"));
    // whole row is clickable (one button = the row itself); no nested action
    // the row is the only button — no nested start action
    expect((rows[0] as HTMLElement).querySelectorAll("button")).toHaveLength(0);
    expect(rows[0]).toHaveTextContent("5 题");
    expect(screen.queryByText("反馈方式")).not.toBeInTheDocument();
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

  it("clicking a unit row creates an immediate single-unit session directly", async () => {
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
    await user.click(document.querySelector("button.unit-row")!);

    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      feedback_mode: "immediate",
      units: [{ release_id: "r-uuid-1", unit_id: "u-v1" }],
      replace_active: false,
    });
    // navigated to the practice page for the new session
    expect(await screen.findByRole("heading", { name: /练习/ })).toBeInTheDocument();
  });

  it("an active session containing the unit resumes it instead of replacing", async () => {
    const user = userEvent.setup();
    useOutlineHandler();
    const current = {
      ...oldSession, id: "old-session",
      units: [{ id: "su-old", release_id: "r-uuid-1", exam_id: "E-N2-2018-12",
                unit_id: "u-v1", position: 1, state: "pending",
                submitted_at: null }],
    };
    let created = 0;
    server.use(
      http.get(`*/api/practice/sessions/current`, () =>
        HttpResponse.json(current)),
      http.post(`*/api/practice/sessions`, () => {
        created += 1;
        return HttpResponse.json(createdSession, { status: 201 });
      }),
    );

    renderDetail();
    await user.click(await screen.findByRole("button", { name: /問題1/ }));
    await user.click(document.querySelector("button.unit-row")!);
    // resumed the SAME session, no new session created
    expect(created).toBe(0);
    expect(await screen.findByRole("heading", { name: /练习/ })).toBeInTheDocument();
  });

  it("shows ONE conflict dialog with three actions; 开始新练习 replaces atomically", async () => {
    const user = userEvent.setup();
    useOutlineHandler();
    const created: Record<string, unknown>[] = [];
    server.use(
      http.get(`*/api/practice/sessions/current`, () =>
        HttpResponse.json(oldSession)),
      http.post(`*/api/practice/sessions`, async ({ request }) => {
        created.push(await request.json() as Record<string, unknown>);
        return HttpResponse.json(createdSession, { status: 201 });
      }),
    );

    const rendered = renderDetail();
    await user.click(await screen.findByRole("button", { name: /問題1/ }));
    await user.click(document.querySelector("button.unit-row")!);

    const dialog = await screen.findByRole("dialog", { name: "继续旧练习？" });
    expect(dialog).toHaveTextContent("开始新练习将结束旧练习，已提交的答案会保留");
    expect(within(dialog).getByRole("button", { name: "取消" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "继续旧练习" })).toBeInTheDocument();

    // 开始新练习 → atomic replace, no second confirmation dialog
    await user.click(within(dialog).getByRole("button", { name: "开始新练习" }));
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ replace_active: true,
      units: [{ release_id: "r-uuid-1", unit_id: "u-v1" }] });
    const nav = await waitFor(() =>
      rendered.router.state.location.pathname === "/study/practice/new-session",
      { timeout: 3000 });
    expect(nav).toBe(true);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
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
    await user.click(document.querySelector("button.unit-row")!);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("开始练习失败");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
