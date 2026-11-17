import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderRoutes } from "../test/render";
import { Breadcrumb } from "./Breadcrumb";

function show(items: Parameters<typeof Breadcrumb>[0]["items"]) {
  renderRoutes([{ path: "x", element: <Breadcrumb items={items} /> }], "/x");
}

describe("Breadcrumb", () => {
  it("renders ancestors as links and the last crumb as the current page", () => {
    show([{ label: "试卷", to: "/study/exams" }, { label: "详情" }]);
    const nav = screen.getByRole("navigation", { name: "面包屑" });
    const items = within(nav).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByRole("link", { name: "试卷" }))
      .toHaveAttribute("href", "/study/exams");
    expect(within(items[1]!).getByText("详情")).toHaveAttribute("aria-current", "page");
  });

  it("separators are decorative (hidden from assistive tech) and only between crumbs", () => {
    show([{ label: "A", to: "/a" }, { label: "B", to: "/b" }, { label: "C" }]);
    const seps = document.querySelectorAll(".breadcrumb-sep");
    expect(seps).toHaveLength(2);
    seps.forEach((s) => expect(s).toHaveAttribute("aria-hidden", "true"));
    // the accessible text of the trail has no separator characters
    expect(screen.getByRole("navigation").textContent).toContain("A›B›C");
    expect(screen.getAllByRole("link").map((a) => a.textContent)).toEqual(["A", "B"]);
  });

  it("a crumb without a target is plain text even when not last", () => {
    show([{ label: "A" }, { label: "B" }]);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.getByText("B")).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("A")).not.toHaveAttribute("aria-current");
  });
});
