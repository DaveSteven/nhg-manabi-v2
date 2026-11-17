import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UnansweredConfirmDialog } from "./SubmitDialogs";

const noop = () => {};

describe("UnansweredConfirmDialog wording", () => {
  it("states the count when questions are unanswered", () => {
    render(<UnansweredConfirmDialog count={2} submitting={false}
                                    onConfirm={noop} onCancel={noop} />);
    expect(screen.getByRole("dialog", { name: "还有题目未作答" }))
    .toHaveTextContent("本组还有 2 题未作答");
    expect(screen.getByRole("button", { name: "继续答题" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认提交" })).toBeInTheDocument();
  });

  // count=0 never renders a dialog: fully-answered groups submit directly
  // (quick-practice spec §4.2) — covered by PracticePage integration tests.
});
