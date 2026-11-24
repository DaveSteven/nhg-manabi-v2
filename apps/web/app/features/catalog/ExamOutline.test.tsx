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
    {
      section_id: "sec-r", subject: "reading", position: 3, title: "読解",
      layers: [
        {
          layer_id: "ly-r1", position: 1, question_type_id: "reading_short",
          display_label: "問題13", instruction: null,
          units: [
            { unit_id: "u-r1", position: 1, kind: "passage", label: null,
              question_type_id: "reading_short", question_count: 2 },
          ],
        },
      ],
    },
  ],
};

const createdSession = {
  id: "new-session",
  mode: "quick_practice",
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
    http.post(`*/api/quick-practice/sessions`, () =>
      HttpResponse.json(createdSession, { status: 201 })),
    http.get(`*/api/releases/r-uuid-1/units/u-v1`, () =>
      HttpResponse.json(practiceUnit)),
    http.get(`*/api/releases/r-uuid-1/units/u-v2`, () =>
      HttpResponse.json({ ...practiceUnit, id: "u-v2", label: "文章語彙" })),
    http.get(`*/api/practice/sessions/:sessionId/drafts`, () =>
      HttpResponse.json({ drafts: [] })),
    http.get(`*/api/practice/sessions/:sessionId`, () => {
      const { units_meta: _drop, ...session } = createdSession;
      return HttpResponse.json(session);
    }),
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

  it("reading unit rows are whole-row buttons with count and chevron, no inner start button", async () => {
    const user = userEvent.setup();
    useOutlineHandler();
    renderDetail();
    await user.click(await screen.findByRole("tab", { name: /读解/ }));
    const toggle = await screen.findByRole("button", { name: /問題13/ });
    expect(toggle).toHaveClass("capsule-card");
    await user.click(toggle);
    const rows = document.querySelectorAll("button.unit-row");
    expect(rows.length).toBeGreaterThan(0);
    rows.forEach((r) => expect(r).toHaveClass("capsule-card"));
    expect((rows[0] as HTMLElement).querySelectorAll("button")).toHaveLength(0);
    expect(screen.queryByText("反馈方式")).not.toBeInTheDocument();
  });

  it("vocabulary 問題N is one click: all its units in one practice session", async () => {
    const user = userEvent.setup();
    useOutlineHandler();
    const created: Record<string, unknown>[] = [];
    server.use(http.post(`*/api/practice/sessions`, async ({ request }) => {
      created.push(await request.json() as Record<string, unknown>);
      return HttpResponse.json({ ...createdSession, mode: "practice" },
                               { status: 201 });
    }));
    renderDetail();
    const layer = await screen.findByRole("button", { name: /問題1/ });
    expect(layer).not.toHaveAttribute("aria-expanded"); // no unit list
    await user.click(layer);
    expect(created).toEqual([{
      feedback_mode: "immediate",
      units: [{ release_id: "r-uuid-1", unit_id: "u-v1" }],
    }]);
    expect(document.querySelector("button.unit-row")).toBeNull();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("grammar 問題N also starts the whole layer directly", async () => {
    const user = userEvent.setup();
    useOutlineHandler();
    const created: Record<string, unknown>[] = [];
    server.use(http.post(`*/api/practice/sessions`, async ({ request }) => {
      created.push(await request.json() as Record<string, unknown>);
      return HttpResponse.json({ ...createdSession, mode: "practice" },
                               { status: 201 });
    }));
    renderDetail();
    await user.click(await screen.findByRole("tab", { name: "文法" }));
    await user.click(screen.getByRole("button", { name: /問題9/ }));
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      units: [{ release_id: "r-uuid-1", unit_id: "u-g1" }] });
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

  it("clicking a reading unit row creates a quick_practice session directly", async () => {
    const user = userEvent.setup();
    useOutlineHandler();
    const created: Record<string, unknown>[] = [];
    server.use(http.post(`*/api/quick-practice/sessions`,
      async ({ request }) => {
        created.push(await request.json() as Record<string, unknown>);
        return HttpResponse.json(createdSession, { status: 201 });
      }));
    renderDetail();
    await user.click(await screen.findByRole("tab", { name: /读解/ }));
    await user.click(await screen.findByRole("button", { name: /問題13/ }));
    await user.click(document.querySelector("button.unit-row")!);
    expect(created).toEqual([{ release_id: "r-uuid-1", unit_id: "u-r1" }]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows 已练习 X/Y per layer and per-unit counts from the server", async () => {
    const user = userEvent.setup();
    useOutlineHandler();
    server.use(http.get(`*/api/exams/E-N2-2018-12/practice-status`, () =>
      HttpResponse.json({
        exam_id: "E-N2-2018-12",
        units: [{ unit_id: "u-v1", submitted_count: 2,
                  last_submitted_at: "2026-11-17T00:00:00+00:00" },
                { unit_id: "u-r1", submitted_count: 3,
                  last_submitted_at: "2026-11-17T00:00:00+00:00" }],
      })));
    renderDetail();
    const layerToggle = await screen.findByRole("button", { name: /問題1/ });
    await waitFor(() => expect(layerToggle).toHaveTextContent("已练习1/1"));
    await user.click(screen.getByRole("tab", { name: "文法" }));
    expect(screen.getByRole("button", { name: /問題9/ }))
      .toHaveTextContent("已练习0/1");
    await user.click(screen.getByRole("tab", { name: /读解/ }));
    await user.click(screen.getByRole("button", { name: /問題13/ }));
    const row = document.querySelector("button.unit-row")!;
    expect(row).toHaveTextContent("已练习 3 次");
    expect(screen.queryByText("✓")).not.toBeInTheDocument();
  });

  it("surfaces layer creation errors without a dialog", async () => {
    const user = userEvent.setup();
    useOutlineHandler();
    server.use(http.post(`*/api/practice/sessions`, () =>
      HttpResponse.json({ detail: {
        code: "unit_not_available", message: "unit not available",
      } }, { status: 422 })));
    renderDetail();
    await user.click(await screen.findByRole("button", { name: /問題1/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("开始练习失败");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
