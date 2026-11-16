import { beforeAll, afterAll, afterEach, describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "../../test/mocks/server";
import { renderRoutes } from "../../test/render";
import { chooseOption } from "../../test/select";
import StudyLayout from "../../routes/study";
import ExamListPage from "../../routes/study.exams._index";

const exams = [
  { exam_id: "E-N2-2018-12", release_id: "r2", revision: 1, level: "N2",
    year: 2018, month: 12, title: "2018年12月 N2" },
  { exam_id: "E-N5-2018-07", release_id: "r5", revision: 1, level: "N5",
    year: 2018, month: 7, title: "2018年7月 N5" },
  { exam_id: "E-N1-2019-07", release_id: "r1", revision: 1, level: "N1",
    year: 2019, month: 7, title: "2019年7月 N1" },
];

// a full N2 history: 2026 only has July, 2025 has July and December
const n2 = [
  ["2025", 12], ["2026", 7], ["2025", 7], ["2024", 12],
].map(([y, m]) => ({
  exam_id: `E-N2-${y}-${m}`, release_id: `r-${y}-${m}`, revision: 1,
  level: "N2", year: Number(y), month: m as number, title: `${y}年${m}月 N2`,
}));

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  window.localStorage.clear();
});
afterAll(() => server.close());

function useExamsHandler(list = exams) {
  server.use(http.get(`*/api/exams`, () => HttpResponse.json(list)));
}

function renderList(url = "/study/exams") {
  return renderRoutes(
    [{ path: "study", Component: StudyLayout,
       children: [{ path: "exams", Component: ExamListPage }] }],
    url,
  );
}

const rowOf = (year: string) => screen.getByRole("listitem", { name: `${year}年` });

describe("ExamList", () => {
  it("groups exams into year rows (newest first) with month capsules", async () => {
    useExamsHandler(n2);
    window.localStorage.setItem("jlptgo.level", "N2");
    renderList();
    await screen.findByRole("listitem", { name: "2026年" });
    const years = screen.getAllByRole("listitem")
      .filter((li) => /^\d{4}年$/.test(li.getAttribute("aria-label") ?? ""))
      .map((li) => li.getAttribute("aria-label"));
    expect(years).toEqual(["2026年", "2025年", "2024年"]);
    // 2025: 7月 before 12月; 2026 only has 7月
    const months = (y: string) => within(rowOf(y)).getAllByRole("link")
      .map((a) => a.textContent);
    expect(months("2025")).toEqual(["7月", "12月"]);
    expect(months("2026")).toEqual(["7月"]);
    // the capsule links to the exam and its accessible name carries the year
    expect(within(rowOf("2025")).getByRole("link", { name: "2025年12月 N2" }))
      .toHaveAttribute("href", "/study/exams/E-N2-2025-12");
  });

  it("shows the level on each capsule only when no target level is set", async () => {
    useExamsHandler();
    renderList();
    await screen.findByRole("listitem", { name: "2019年" });
    expect(within(rowOf("2019")).getByRole("link")).toHaveTextContent("7月N1");
    // 2018 holds two different levels as two capsules, 7月 (N5) before 12月 (N2)
    expect(within(rowOf("2018")).getAllByRole("link").map((a) => a.textContent))
      .toEqual(["7月N5", "12月N2"]);
  });

  it("has no level filter, only a year filter", async () => {
    useExamsHandler();
    renderList();
    await screen.findByRole("listitem", { name: "2019年" });
    expect(screen.queryByRole("combobox", { name: "等级" })).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "年份" })).toBeInTheDocument();
  });

  it("filters by year via the URL search params", async () => {
    const user = userEvent.setup();
    useExamsHandler();
    const rendered = renderList();
    await screen.findByRole("listitem", { name: "2018年" });
    await chooseOption(user, "年份", "2019");
    expect(rendered.router.state.location.search).toBe("?year=2019");
    expect(screen.getByRole("listitem", { name: "2019年" })).toBeInTheDocument();
    expect(screen.queryByRole("listitem", { name: "2018年" })).not.toBeInTheDocument();
    // back to 全部 removes the param
    await chooseOption(user, "年份", "全部");
    expect(rendered.router.state.location.search).toBe("");
    expect(screen.getByRole("listitem", { name: "2018年" })).toBeInTheDocument();
  });

  it("follows the target level: only that level's exams and years are offered", async () => {
    const user = userEvent.setup();
    useExamsHandler();
    window.localStorage.setItem("jlptgo.level", "N5");
    renderList();
    await screen.findByRole("listitem", { name: "2018年" });
    expect(screen.queryByRole("listitem", { name: "2019年" })).not.toBeInTheDocument();
    // N5 only has 2018 → one capsule, no level tag inside it
    expect(within(rowOf("2018")).getAllByRole("link")).toHaveLength(1);
    expect(within(rowOf("2018")).getByRole("link")).toHaveTextContent(/^7月$/);
    await user.click(screen.getByRole("combobox", { name: "年份" }));
    expect(screen.getAllByRole("option").map((o) => o.textContent))
      .toEqual(["全部", "2018"]);
  });

  it("explains a target level with no published exams", async () => {
    useExamsHandler([exams[2]!]);
    window.localStorage.setItem("jlptgo.level", "N4");
    renderList();
    expect(await screen.findByText(/暂无 N4 已发布试卷/)).toBeInTheDocument();
    expect(screen.queryByRole("listitem", { name: "2019年" })).not.toBeInTheDocument();
  });

  it("a guest changing the header level updates the list immediately", async () => {
    const user = userEvent.setup();
    useExamsHandler();
    renderList();
    await screen.findByRole("listitem", { name: "2019年" });
    await chooseOption(user, "备考等级", "N5");
    expect(screen.queryByRole("listitem", { name: "2019年" })).not.toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: "2018年" })).toBeInTheDocument();
    expect(window.localStorage.getItem("jlptgo.level")).toBe("N5");
    // and back to all levels
    await chooseOption(user, "备考等级", "全部等级");
    expect(screen.getByRole("listitem", { name: "2019年" })).toBeInTheDocument();
    expect(window.localStorage.getItem("jlptgo.level")).toBeNull();
  });
});
