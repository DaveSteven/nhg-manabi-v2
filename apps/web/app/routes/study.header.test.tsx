import { afterEach, describe, expect, it } from "vitest";
import { beforeEach } from "vitest";
import { act, cleanup, screen } from "@testing-library/react";
import { renderRoutes, signInForTest } from "../test/render";
import { authStore } from "../features/auth/authStore";
import { notifyUnauthorized } from "../api/authToken";
import StudyLayout from "./study";

beforeEach(() => signInForTest());

function setScroll(y: number) {
  Object.defineProperty(window, "scrollY", { value: y, configurable: true });
  act(() => { window.dispatchEvent(new Event("scroll")); });
}

afterEach(() => setScroll(0));

describe("study header sticky state", () => {
  it("adds is-stuck once scrolled past the threshold and removes it at the top", () => {
    renderRoutes([{ path: "study", Component: StudyLayout,
      children: [{ index: true, element: <p>page</p> }] }], "/study");
    const header = screen.getByRole("banner");
    expect(header).toHaveClass("site-header");
    expect(header).not.toHaveClass("is-stuck");

    setScroll(3); // within the 8px dead zone
    expect(header).not.toHaveClass("is-stuck");

    setScroll(120);
    expect(header).toHaveClass("is-stuck");

    setScroll(0);
    expect(header).not.toHaveClass("is-stuck");
  });
});

describe("study auth guard (ADR-0036)", () => {
  const routes = [
    { path: "study", Component: StudyLayout,
      children: [{ index: true, element: <p>home page</p> },
        { path: "exams", element: <p>exams page</p> },
        { path: "exams/:id", element: <p>exam detail</p> }] },
    { path: "login", element: <p>login page</p> },
  ];

  it("lets guests browse the home page and the exam catalog", () => {
    authStore.clear();
    renderRoutes(routes, "/study/exams");
    expect(screen.getByText("exams page")).toBeInTheDocument();
    cleanup();
    renderRoutes(routes, "/study");
    expect(screen.getByText("home page")).toBeInTheDocument();
  });

  it("sends guests from any other /study page to /login", () => {
    authStore.clear();
    const { router } = renderRoutes(routes, "/study/exams/E-1?x=1");
    expect(screen.getByText("login page")).toBeInTheDocument();
    expect(screen.queryByText("exam detail")).not.toBeInTheDocument();
    expect(router.state.location.state).toEqual({ from: "/study/exams/E-1?x=1" });
  });

  it("lets signed-in students through", () => {
    renderRoutes(routes, "/study/exams");
    expect(screen.getByText("exams page")).toBeInTheDocument();
  });

  it("a 401 on an authenticated request drops the session and redirects", () => {
    renderRoutes(routes, "/study/exams/E-1");
    act(() => { notifyUnauthorized(); });
    expect(screen.getByText("login page")).toBeInTheDocument();
    expect(authStore.get().user).toBeNull();
  });
});
