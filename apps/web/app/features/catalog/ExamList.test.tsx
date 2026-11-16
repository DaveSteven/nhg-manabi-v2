import { beforeAll, afterAll, afterEach, describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { ORIGIN, server } from "../../test/mocks/server";
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

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function useExamsHandler() {
  server.use(http.get(`*/api/exams`, () => HttpResponse.json(exams)));
}

describe("ExamList", () => {
  it("renders real level/year/month/title without hardcoding months", async () => {
    useExamsHandler();
    renderRoutes(
      [{ path: "study", Component: StudyLayout,
         children: [{ path: "exams", Component: ExamListPage }] }],
      "/study/exams",
    );
    expect(await screen.findByText("2018年7月 N5")).toBeInTheDocument();
    expect(screen.getByText("2018年12月 N2")).toBeInTheDocument();
    expect(screen.getByText("2019年7月 N1")).toBeInTheDocument();
  });

  it("has no level filter, only a year filter", async () => {
    useExamsHandler();
    renderRoutes(
      [{ path: "study", Component: StudyLayout,
         children: [{ path: "exams", Component: ExamListPage }] }],
      "/study/exams",
    );
    await screen.findByText("2018年12月 N2");
    expect(screen.queryByRole("combobox", { name: "等级" })).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "年份" })).toBeInTheDocument();
  });

  it("filters by year via the URL search params", async () => {
    const user = userEvent.setup();
    useExamsHandler();
    const rendered = renderRoutes(
      [{ path: "study", Component: StudyLayout,
         children: [{ path: "exams", Component: ExamListPage }] }],
      "/study/exams",
    );
    await screen.findByText("2018年12月 N2");
    await chooseOption(user, "年份", "2019");
    expect(rendered.router.state.location.search).toBe("?year=2019");
    expect(screen.getByText("2019年7月 N1")).toBeInTheDocument();
    expect(screen.queryByText("2018年12月 N2")).not.toBeInTheDocument();
    // back to 全部 removes the param
    await chooseOption(user, "年份", "全部");
    expect(rendered.router.state.location.search).toBe("");
    expect(screen.getByText("2018年12月 N2")).toBeInTheDocument();
  });

  it("follows the target level: only that level's exams and years are offered", async () => {
    const user = userEvent.setup();
    useExamsHandler();
    window.localStorage.setItem("jlptgo.level", "N5");
    renderRoutes(
      [{ path: "study", Component: StudyLayout,
         children: [{ path: "exams", Component: ExamListPage }] }],
      "/study/exams",
    );
    await screen.findByText("2018年7月 N5");
    expect(screen.queryByText("2018年12月 N2")).not.toBeInTheDocument();
    expect(screen.queryByText("2019年7月 N1")).not.toBeInTheDocument();
    // the year list only contains N5's years (2018), not N1's 2019
    await user.click(screen.getByRole("combobox", { name: "年份" }));
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["全部", "2018"]);
    window.localStorage.removeItem("jlptgo.level");
  });

  it("explains a target level with no published exams", async () => {
    server.use(http.get(`*/api/exams`, () => HttpResponse.json([exams[2]])));
    window.localStorage.setItem("jlptgo.level", "N4");
    renderRoutes(
      [{ path: "study", Component: StudyLayout,
         children: [{ path: "exams", Component: ExamListPage }] }],
      "/study/exams",
    );
    expect(await screen.findByText(/暂无 N4 已发布试卷/)).toBeInTheDocument();
    expect(screen.queryByText("2019年7月 N1")).not.toBeInTheDocument();
    window.localStorage.removeItem("jlptgo.level");
  });

  it("links to exam detail routes", async () => {
    useExamsHandler();
    const rendered = renderRoutes(
      [{ path: "study", Component: StudyLayout,
         children: [{ path: "exams", Component: ExamListPage }] }],
      "/study/exams",
    );
    const links = await screen.findAllByRole("link", { name: "查看试卷" });
    expect(links[0]).toHaveAttribute("href", "/study/exams/E-N2-2018-12");
    void rendered;
  });
});
