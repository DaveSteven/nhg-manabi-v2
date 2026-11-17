import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderRoutes, renderWithQuery } from "../test/render";
import { TopNav } from "./TopNav";
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

  it("专项 links to the topic practice page; 学习 stays 暂未开放", () => {
    renderRoutes([{ path: "study", Component: StudyLayout }], "/study");
    expect(screen.getByText("专项").closest("a"))
      .toHaveAttribute("href", "/study/practice");
    const btn = screen.getByText("学习").closest("button");
    expect(btn).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: /学习\s*（暂未开放）/ }))
      .toBeInTheDocument();
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
