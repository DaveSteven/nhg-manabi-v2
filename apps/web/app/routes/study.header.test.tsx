import { afterEach, describe, expect, it } from "vitest";
import { act, screen } from "@testing-library/react";
import { renderRoutes } from "../test/render";
import StudyLayout from "./study";

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
