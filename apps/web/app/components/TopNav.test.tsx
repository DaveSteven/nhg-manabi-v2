import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderRoutes, renderWithQuery } from "../test/render";
import { TopNav } from "./TopNav";
import { PracticeBreadcrumb } from "../features/practice/PracticeBreadcrumb";
import StudyLayout from "../routes/study";
import StudyHome from "../routes/study._index";
import ExamListPage from "../routes/study.exams._index";
import ExamDetailPage from "../routes/study.exams.$examId";
import PracticePage from "../routes/study.practice.$sessionId";
import ResultsPage from "../routes/study.practice.$sessionId.results";

describe("TopNav", () => {
  it("renders exactly four nav items", () => {
    renderRoutes([{ path: "study", Component: StudyLayout }], "/study");
    const nav = screen.getByRole("navigation", { name: "主导航" });
    expect(nav).toBeInTheDocument();
    // two links + two disabled entries
    expect(screen.getByText("首页").closest("a")).toHaveAttribute("href", "/study");
    expect(screen.getByText("试卷").closest("a"))
      .toHaveAttribute("href", "/study/exams");
  });

  it("首页 is active only on /study exactly, not on child routes", () => {
    renderRoutes([{ path: "study", Component: StudyLayout,
                    children: [{ path: "exams", Component: () => <p>exams</p> }] }],
                 "/study/exams");
    expect(screen.getByText("首页").closest("a")).not.toHaveClass("active");
    expect(screen.getByText("试卷").closest("a")).toHaveClass("active");
  });

  it("专项 and 学习 link to their pages", () => {
    renderRoutes([{ path: "study", Component: StudyLayout }], "/study");
    expect(screen.getByText("专项").closest("a"))
      .toHaveAttribute("href", "/study/practice");
    expect(screen.getByText("学习").closest("a"))
      .toHaveAttribute("href", "/study/learning");
  });
});

describe("route tree smoke", () => {
  const routes = [
    {
      path: "study",
      Component: StudyLayout,
      children: [
        { index: true, Component: StudyHome },
        { path: "exams", Component: ExamListPage },
        { path: "exams/:examId", Component: ExamDetailPage },
        { path: "practice/:sessionId", Component: PracticePage },
        { path: "practice/:sessionId/results", Component: ResultsPage },
      ],
    },
  ];

  it.each([
    "/study",
    "/study/exams",
    "/study/exams/N2-2018-12",
    "/study/practice/some-session-id",
    "/study/practice/some-session-id/results",
  ])("renders %s without crashing with TopNav present", (url) => {
    renderRoutes(routes, url);
    expect(screen.getByRole("navigation", { name: "主导航" })).toBeInTheDocument();
  });

  it("brand home is not under the study layout", () => {
    renderRoutes([{ path: "/", element: <main><h1>JLPT GO</h1></main> }], "/");
    expect(screen.queryByRole("navigation", { name: "主导航" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("JLPT GO");
  });
});

describe("TopNav section highlight on practice pages", () => {
  it.each([
    ["topic", "专项"],
    ["exams", "试卷"],
  ] as const)("practice breadcrumb %s highlights %s", (kind, name) => {
    function Page() {
      return <PracticeBreadcrumb current="练习" examId={null} topic={kind === "topic"} />;
    }
    renderRoutes([{ path: "study", Component: StudyLayout,
      children: [{ path: "practice/:id", Component: Page }] }], "/study/practice/s-1");
    const nav = within(screen.getByRole("navigation", { name: "主导航" }));
    expect(nav.getByRole("link", { name })).toHaveClass("active");
    const other = kind === "topic" ? "试卷" : "专项";
    expect(nav.getByRole("link", { name: other })).not.toHaveClass("active");
  });
});
