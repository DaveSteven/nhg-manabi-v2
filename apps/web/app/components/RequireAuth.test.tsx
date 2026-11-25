import { beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, screen } from "@testing-library/react";
import { renderRoutes, signInForTest } from "../test/render";
import { authStore } from "../features/auth/authStore";
import { notifyUnauthorized } from "../api/authToken";
import { RequireAuth } from "./RequireAuth";

// Mirrors routes.ts: what is nested under RequireAuth needs login, the rest is public.
const routes = [
  { path: "study", children: [
    { index: true, element: <p>home page</p> },
    { path: "exams/:id", element: <p>exam detail</p> },
    { Component: RequireAuth, children: [
      { path: "exams/:id/mock", element: <p>mock page</p> },
      { path: "learning", element: <p>learning page</p> },
    ] },
  ] },
  { Component: RequireAuth, children: [
    { path: "mock/:sessionId", element: <p>strict mock</p> },
  ] },
  { path: "login", element: <p>login page</p> },
];

beforeEach(() => authStore.clear());

describe("RequireAuth (ADR-0036)", () => {
  it("leaves routes outside the guard open to guests", () => {
    renderRoutes(routes, "/study");
    expect(screen.getByText("home page")).toBeInTheDocument();
    cleanup();
    renderRoutes(routes, "/study/exams/E-1");
    expect(screen.getByText("exam detail")).toBeInTheDocument();
  });

  it.each(["/study/learning", "/study/exams/E-1/mock", "/mock/s-1"])(
    "sends guests from %s to /login", (url) => {
      const { router } = renderRoutes(routes, `${url}?x=1`);
      expect(screen.getByText("login page")).toBeInTheDocument();
      expect(router.state.location.state).toEqual({ from: `${url}?x=1` });
    });

  it("lets signed-in students through, including the strict mock page", () => {
    signInForTest();
    renderRoutes(routes, "/mock/s-1");
    expect(screen.getByText("strict mock")).toBeInTheDocument();
  });

  it("a 401 on an authenticated request drops the session and redirects", () => {
    signInForTest();
    renderRoutes(routes, "/study/learning");
    expect(screen.getByText("learning page")).toBeInTheDocument();
    act(() => { notifyUnauthorized(); });
    expect(screen.getByText("login page")).toBeInTheDocument();
    expect(authStore.get().user).toBeNull();
  });
});
