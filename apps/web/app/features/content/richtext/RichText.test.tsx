import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithQuery } from "../../../test/render";
import { RichText } from "./RichText";

const P = (text: string, marks?: string[]) =>
  ({ type: "paragraph", children: [{ type: "text", text, ...(marks ? { marks } : {}) }] });
const DOC = (blocks: unknown[]) =>
  ({ format: "jlptgo-richtext-v1", blocks });

describe("RichText whitelist renderer", () => {
  it("renders normal text, marks, and slots", () => {
    renderWithQuery(<RichText slotIds={["s1"]} value={DOC([
      P("二人は"),
      { type: "paragraph", children: [
        { type: "text", text: "離れて", marks: ["underline"] },
        { type: "slot", slot_id: "s1", children: [{ type: "text", text: "（　1　）" }] },
        { type: "text", text: "座った。" },
      ] },
    ])} />);
    expect(screen.getByText("二人は")).toBeInTheDocument();
    expect(screen.getByText("離れて").closest("u")).toBeInTheDocument();
    // full-width spaces defeat exact text matchers; query the slot anchor
    const slot = document.querySelector(".richtext-slot[data-slot-id='s1']");
    expect(slot).not.toBeNull();
    expect(slot!.textContent).toContain("1");
  });

  it("renders ruby and break and lists", () => {
    renderWithQuery(<RichText value={DOC([
      { type: "paragraph", children: [
        { type: "ruby", base: "折り紙", ruby: "おりがみ" },
        { type: "break" },
        { type: "text", text: "次行" },
      ] },
      { type: "list", ordered: true, items: [
        { children: [{ type: "text", text: "一" }] },
        { children: [{ type: "text", text: "二" }] },
      ] },
    ])} />);
    expect(screen.getByText("折り紙").closest("ruby")).toBeInTheDocument();
    expect(screen.getByText("おりがみ").closest("rt")).toBeInTheDocument();
    expect(screen.getByRole("list")).toBeInTheDocument();
    expect(screen.getByText("一")).toBeInTheDocument();
  });

  it("renders empty blocks without crashing", () => {
    renderWithQuery(<RichText value={DOC([])} />);
    expect(document.querySelector(".richtext")).toBeInTheDocument();
  });

  it("renders safe unsupported state for unknown node types", () => {
    const diag = vi.fn();
    renderWithQuery(<RichText onDiagnostic={diag} value={DOC([
      { type: "paragraph", children: [
        { type: "iframe", src: "javascript:alert(1)" },
      ] },
    ])} />);
    expect(screen.getByTestId("richtext-unsupported")).toBeInTheDocument();
    expect(screen.queryByText("javascript:alert(1)")).not.toBeInTheDocument();
    expect(diag).toHaveBeenCalled();
  });

  it("rejects malicious attribute shapes (no raw attribute passthrough)", () => {
    renderWithQuery(<RichText value={{
      format: "jlptgo-richtext-v1",
      blocks: [
        { type: "paragraph", "onclick": "alert(1)",
          children: [{ type: "text", text: "x" }] } as never,
      ],
    }} />);
    // strictObject rejects the extra attribute → unsupported state
    expect(screen.getByTestId("richtext-unsupported")).toBeInTheDocument();
  });

  it("renders unsupported state for wrong format field", () => {
    renderWithQuery(<RichText value={{ format: "html", blocks: [] }} />);
    expect(screen.getByTestId("richtext-unsupported")).toBeInTheDocument();
  });

  it("caps pathological nesting depth", () => {
    let child: unknown = { type: "text", text: "deep" };
    for (let i = 0; i < 60; i++) {
      child = { type: "paragraph", children: [child] };
    }
    renderWithQuery(<RichText value={DOC([child as never])} />);
    // Either renders safely or reports unsupported — never crashes.
    const ok = document.querySelector(".richtext") !== null
      || screen.queryByTestId("richtext-unsupported") !== null;
    expect(ok).toBe(true);
  });

  it("slot errors: duplicate slot id in one document", () => {
    renderWithQuery(<RichText slotIds={["s1", "s2"]} value={DOC([
      P("a"),
      { type: "paragraph", children: [
        { type: "slot", slot_id: "s1", children: [{ type: "text", text: "1" }] },
        { type: "slot", slot_id: "s1", children: [{ type: "text", text: "1" }] },
      ] },
    ])} />);
    expect(screen.getByTestId("richtext-slot-error")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("填空数据异常");
  });

  it("slot errors: slot not in unit slot_ids", () => {
    renderWithQuery(<RichText slotIds={["s1"]} value={DOC([
      { type: "paragraph", children: [
        { type: "slot", slot_id: "sX", children: [{ type: "text", text: "?" }] },
      ] },
    ])} />);
    expect(screen.getByTestId("richtext-slot-error")).toBeInTheDocument();
  });

  it("heading, table, image blocks render per whitelist", () => {
    renderWithQuery(<RichText value={DOC([
      { type: "heading", children: [{ type: "text", text: "标题" }] },
      { type: "table", rows: [{ cells: ["1", "2"] }] },
      { type: "image", asset_id: "as-img", alt: "图表" },
    ])} />);
    expect(screen.getByText("标题")).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("图表")).toBeInTheDocument();
  });
});
