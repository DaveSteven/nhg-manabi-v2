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
    year: 2018, month: 12, title: "2018年12月 N2", question_count: 96 },
  { exam_id: "E-N5-2018-07", release_id: "r5", revision: 1, level: "N5",
    year: 2018, month: 7, title: "2018年7月 N5", question_count: 40 },
  { exam_id: "E-N1-2019-07", release_id: "r1", revision: 1, level: "N1",
    year: 2019, month: 7, title: "2019年7月 N1", question_count: 96 },
];

// a full N2 history: 2026 only has July, 2025 has July and December
const n2 = [
  ["2025", 12], ["2026", 7], ["2025", 7], ["2024", 12],
].map(([y, m]) => ({
  exam_id: `E-N2-${y}-${m}`, release_id: `r-${y}-${m}`, revision: 1,
  level: "N2", year: Number(y), month: m as number, title: `${y}年${m}月 N2`,
  question_count: 96,
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
      .map((a) => a.querySelector("span")!.textContent);
    expect(months("2025")).toEqual(["7月", "12月"]);
    expect(months("2026")).toEqual(["7月"]);
    // the capsule links to the exam and its accessible name carries the year
    expect(within(rowOf("2025")).getByRole("link", { name: "2025年12月 N2，96 题" }))
      .toHaveAttribute("href", "/study/exams/E-N2-2025-12");
  });

  it("aligns each capsule in its month's column, derived from the data", async () => {
    useExamsHandler(n2); // months present: 7 and 12 → two columns
    window.localStorage.setItem("jlptgo.level", "N2");
    renderList();
    await screen.findByRole("listitem", { name: "2024年" });
    const col = (y: string, name: string) => within(rowOf(y))
      .getByRole("link", { name: new RegExp(`^${name}`) }).closest("li")!.style.gridColumn;
    expect(col("2025", "2025年7月 N2")).toBe("1");
    expect(col("2025", "2025年12月 N2")).toBe("2");
    // 2024 only has 12月 → still the second column, under the other 12月
    expect(col("2024", "2024年12月 N2")).toBe("2");
    expect(within(rowOf("2024")).getByRole("list")).toHaveStyle(
      { gridTemplateColumns: "repeat(2, minmax(0, 1fr))" });
  });

  it("uses a single full-width column when only one month exists", async () => {
    useExamsHandler([n2[3]!]);         // only 2024-12
    window.localStorage.setItem("jlptgo.level", "N2");
    renderList();
    await screen.findByRole("listitem", { name: "2024年" });
    expect(within(rowOf("2024")).getByRole("list")).toHaveStyle(
      { gridTemplateColumns: "repeat(1, minmax(0, 1fr))" });
  });

  it("shows the level on each capsule only when no target level is set", async () => {
    useExamsHandler();
    renderList();
    await screen.findByRole("listitem", { name: "2019年" });
    expect(within(rowOf("2019")).getByRole("link")).toHaveTextContent("7月N196 题");
    // 2018 holds two different levels as two capsules, 7月 (N5) before 12月 (N2)
    expect(within(rowOf("2018")).getAllByRole("link").map((a) => a.textContent))
      .toEqual(["7月N540 题", "12月N296 题"]);
  });

  it("shows each exam's question count at the right of its capsule", async () => {
    useExamsHandler(n2);
    window.localStorage.setItem("jlptgo.level", "N2");
    renderList();
    await screen.findByRole("listitem", { name: "2026年" });
    const chip = within(rowOf("2026")).getByRole("link");
    expect(chip.querySelector(".exam-chip-count")).toHaveTextContent("96 题");
    // month first, count last (left text / right count)
    expect(chip.firstElementChild).toHaveTextContent("7月");
    expect(chip.lastElementChild).toHaveClass("exam-chip-count");
  });

  it("has no filters on the page (no level and no year select)", async () => {
    useExamsHandler();
    renderList();
    await screen.findByRole("listitem", { name: "2019年" });
    // the only combobox left is the header's 备考等级 selector
    expect(screen.getAllByRole("combobox").map((c) => c.getAttribute("aria-label")))
      .toEqual(["备考等级"]);
    expect(screen.queryByText("年份")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "年份" })).not.toBeInTheDocument();
  });

  it("lists every year, newest first, ignoring a stale ?year= in the URL", async () => {
    useExamsHandler();
    renderList("/study/exams?year=2019&level=N5");
    await screen.findByRole("listitem", { name: "2019年" });
    expect(screen.getByRole("listitem", { name: "2018年" })).toBeInTheDocument();
  });

  it("follows the target level: only that level's exams and years are listed", async () => {
    useExamsHandler();
    window.localStorage.setItem("jlptgo.level", "N5");
    renderList();
    await screen.findByRole("listitem", { name: "2018年" });
    expect(screen.queryByRole("listitem", { name: "2019年" })).not.toBeInTheDocument();
    // N5 only has 2018 → one capsule, no level tag inside it
    expect(within(rowOf("2018")).getAllByRole("link")).toHaveLength(1);
    expect(within(rowOf("2018")).getByRole("link")).toHaveTextContent(/^7月40 题$/);
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
