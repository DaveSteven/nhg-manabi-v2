import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Pagination, pageItems } from "./Pagination";

describe("pageItems", () => {
  it("shows everything for few pages and ellipses for many", () => {
    expect(pageItems(0, 3)).toEqual([0, 1, 2]);
    expect(pageItems(0, 20)).toEqual([0, 1, "…", 19]);
    expect(pageItems(9, 20)).toEqual([0, "…", 8, 9, 10, "…", 19]);
    expect(pageItems(19, 20)).toEqual([0, "…", 18, 19]);
  });
  it("never replaces a single missing page with an ellipsis", () => {
    expect(pageItems(3, 20)).toEqual([0, 1, 2, 3, 4, "…", 19]);
    expect(pageItems(2, 5)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("Pagination", () => {
  it("renders nothing when one page is enough", () => {
    const { container } = render(
      <Pagination page={0} total={10} pageSize={10} onPage={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the total, marks the current page and navigates", async () => {
    const seen: number[] = [];
    render(<Pagination page={1} total={45} pageSize={10} onPage={(p) => seen.push(p)} />);
    expect(screen.getByText("共 45 条")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "第 2 页" }))
      .toHaveAttribute("aria-current", "page");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "下一页" }));
    await user.click(screen.getByRole("button", { name: "第 5 页" }));
    await user.click(screen.getByRole("button", { name: "上一页" }));
    expect(seen).toEqual([2, 4, 0]);
  });

  it("disables previous on the first page and next on the last", () => {
    const { rerender } = render(
      <Pagination page={0} total={25} pageSize={10} onPage={() => {}} />);
    expect(screen.getByRole("button", { name: "上一页" })).toBeDisabled();
    rerender(<Pagination page={2} total={25} pageSize={10} onPage={() => {}} />);
    expect(screen.getByRole("button", { name: "下一页" })).toBeDisabled();
  });
});
