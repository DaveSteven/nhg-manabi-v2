import { beforeAll, afterAll, afterEach, describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { ORIGIN, server } from "../../test/mocks/server";
import { renderRoutes } from "../../test/render";
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

  it("filters by level and year via URL search params", async () => {
    const user = userEvent.setup();
    useExamsHandler();
    const rendered = renderRoutes(
      [{ path: "study", Component: StudyLayout,
         children: [{ path: "exams", Component: ExamListPage }] }],
      "/study/exams",
    );
    await screen.findByText("2018年12月 N2");

    await user.selectOptions(screen.getByLabelText(/等级/), "N5");
    expect(screen.queryByText("2018年12月 N2")).not.toBeInTheDocument();
    expect(screen.getByText("2018年7月 N5")).toBeInTheDocument();
    expect(rendered.router.state.location.search).toBe("?level=N5");

    await user.selectOptions(screen.getByLabelText(/年份/), "2018");
    expect(rendered.router.state.location.search).toContain("year=2018");

    // year=2018 + level=N5 → still the N5 2018-07 exam
    expect(screen.getByText("2018年7月 N5")).toBeInTheDocument();
    // level=N2 with year=2018 → the N2 2018-12 exam matches again
    await user.selectOptions(screen.getByLabelText(/等级/), "N2");
    expect(screen.getByText("2018年12月 N2")).toBeInTheDocument();
    // level=N1 with year=2018 → no match at all
    await user.selectOptions(screen.getByLabelText(/等级/), "N1");
    expect(screen.getByText("没有符合条件的试卷。")).toBeInTheDocument();
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
