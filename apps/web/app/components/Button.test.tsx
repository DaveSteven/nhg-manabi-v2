import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { Button, ButtonLink } from "./Button";

describe("Button", () => {
  it("defaults to type=button and secondary/md", () => {
    render(<Button>上一题</Button>);
    const b = screen.getByRole("button", { name: "上一题" });
    expect(b).toHaveAttribute("type", "button");
    expect(b).toHaveClass("btn", "btn-secondary", "btn-md");
  });

  it("loading sets aria-busy and blocks repeat clicks", async () => {
    const onClick = vi.fn();
    render(<Button variant="primary" loading onClick={onClick}>提交中…</Button>);
    const b = screen.getByRole("button", { name: "提交中…" });
    expect(b).toHaveAttribute("aria-busy", "true");
    await userEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("ButtonLink is a real link with button styling", () => {
    render(<MemoryRouter><ButtonLink variant="primary" to="/study">进入</ButtonLink></MemoryRouter>);
    const a = screen.getByRole("link", { name: "进入" });
    expect(a).toHaveAttribute("href", "/study");
    expect(a).toHaveClass("btn", "btn-primary");
  });
});
