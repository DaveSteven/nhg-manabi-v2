import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "../test/mocks/server";
import { renderRoutes } from "../test/render";
import ResultsRoute from "./study.practice.$sessionId.results";
import results from "../api/contract-fixtures/results-get.json";
import sessionGet from "../api/contract-fixtures/session-get.json";

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const topicSession = {
  ...sessionGet.body,
  feedback_mode: "end",
  config: {
    ...sessionGet.body.config,
    topic: { kind: "topic", level: "N2",
             question_type_id: "vocabulary_usage", requested_count: 7 },
  },
};

function renderResults() {
  renderRoutes([
    { path: "study/practice/:sessionId/results", Component: ResultsRoute },
    { path: "study/practice/:id", Component: () => <p>practice page</p> },
  ], "/study/practice/s-1/results");
}

describe("results page for 专项练习 sessions", () => {
  it("uses the 专项练习 trail and redraws with the same configuration", async () => {
    let body: unknown = null;
    server.use(
      http.get("*/api/practice/sessions/s-1/results", () =>
        HttpResponse.json(results.body)),
      http.get("*/api/practice/sessions/s-1", () =>
        HttpResponse.json(topicSession)),
      http.post("*/api/topic-practice/sessions", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ...topicSession, id: "s-2" }, { status: 201 });
      }),
    );
    renderResults();
    const nav = await screen.findByRole("navigation", { name: "面包屑" });
    expect(await within(nav).findByRole("link", { name: "专项练习" }))
      .toHaveAttribute("href", "/study/practice");
    expect(within(nav).queryByRole("link", { name: "详情" })).not.toBeInTheDocument();

    await userEvent.setup().click(
      await screen.findByRole("button", { name: "再练一组" }));
    expect(await screen.findByText("practice page")).toBeInTheDocument();
    // same level/type/count/feedback — never the previously drawn units
    expect(body).toEqual({ level: "N2", question_type_id: "vocabulary_usage",
      count: 7, feedback_mode: "end" });
  });

  it("exam sessions keep 返回试卷列表 and have no 再练一组", async () => {
    server.use(
      http.get("*/api/practice/sessions/s-1/results", () =>
        HttpResponse.json(results.body)),
      http.get("*/api/practice/sessions/s-1", () =>
        HttpResponse.json(sessionGet.body)),
    );
    renderResults();
    expect(await screen.findByRole("link", { name: "返回试卷列表" }))
      .toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "再练一组" })).not.toBeInTheDocument();
  });
});
