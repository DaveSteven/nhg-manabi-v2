import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SharedMaterialLayout, usesSplitLayout } from "./SharedMaterialLayout";
import type { VmContentUnit } from "./viewModel";

const mk = (kind: string, slotIds: string[], withText = true): VmContentUnit => ({
  unit: { releaseId: "r", id: "u", kind, position: 1, label: null, slotIds },
  materials: withText ? [{ id: "m", kind: "passage", role: "primary", language: "ja",
    content: {}, imageAssetId: null, imageUrl: null, audio: null }] : [],
  questions: [
    { id: "q1", position: 1, printedNumber: "48", prompt: null, slotId: slotIds[0] ?? null, options: [] },
    { id: "q2", position: 2, printedNumber: "49", prompt: null, slotId: slotIds[1] ?? null, options: [] },
  ],
});

describe("SharedMaterialLayout", () => {
  it("splits only for passage units or units with slots that have article text", () => {
    expect(usesSplitLayout(mk("passage", []))).toBe(true);
    expect(usesSplitLayout(mk("cloze", ["s1", "s2"]))).toBe(true);
    expect(usesSplitLayout(mk("single", []))).toBe(false);
    expect(usesSplitLayout(mk("passage", [], false))).toBe(false);
  });

  it("non-split: no panel, questions render in order", () => {
    render(<SharedMaterialLayout content={mk("single", [])} material={<p>m</p>} footer={<p>f</p>}>
      <ol><li>Q</li></ol></SharedMaterialLayout>);
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(screen.getByText("f")).toBeInTheDocument();
  });

  it("split: clicking a slot activates its question; footer lives in the panel", async () => {
    const user = userEvent.setup();
    render(<SharedMaterialLayout content={mk("cloze", ["s1", "s2"])}
      material={<p><span data-slot-id="s2">(49)</span></p>}
      footer={<button type="button">提交</button>}>
      <ol>
        <li data-question-id="q1">Q1</li><li data-question-id="q2">Q2</li>
      </ol></SharedMaterialLayout>);
    const panel = screen.getByRole("complementary", { name: "答题面板" });
    expect(panel).toContainElement(screen.getByRole("button", { name: "提交" }));
    expect(screen.getByText("Q1")).toHaveClass("is-active-question"); // starts at first
    await user.click(screen.getByText("(49)"));
    expect(screen.getByText("Q2")).toHaveClass("is-active-question");
    expect(screen.getByText("Q1")).not.toHaveClass("is-active-question");
    await user.click(screen.getByRole("button", { name: "48" }));
    expect(screen.getByText("Q1")).toHaveClass("is-active-question");
    expect(screen.getByRole("button", { name: "上一小题" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "下一小题" }));
    expect(screen.getByText("Q2")).toHaveClass("is-active-question");
    expect(screen.getByText("(49)")).toHaveClass("is-active-slot");
  });
});
