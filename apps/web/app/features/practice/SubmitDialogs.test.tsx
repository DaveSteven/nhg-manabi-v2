import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UnansweredConfirmDialog } from "./SubmitDialogs";

const noop = () => {};

describe("UnansweredConfirmDialog wording", () => {
  it("states the count when questions are unanswered", () => {
    render(<UnansweredConfirmDialog count={2} submitting={false}
                                    onConfirm={noop} onCancel={noop} />);
    expect(screen.getByRole("dialog")).toHaveTextContent("2 道题未作答");
  });

  it("does not claim unanswered questions when everything is answered", () => {
    render(<UnansweredConfirmDialog count={0} submitting={false}
                                    onConfirm={noop} onCancel={noop} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).not.toHaveTextContent("未作答");
    expect(dialog).toHaveTextContent("已全部作答");
  });
});
