import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { ReadingSizeControl } from "./ReadingSizeControl";
import { READING_SCALES, useReadingScale } from "./useReadingScale";

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.style.removeProperty("--reading-scale");
});

describe("useReadingScale", () => {
  it("defaults to standard and does not touch the root variable value", () => {
    const { result } = renderHook(() => useReadingScale());
    expect(result.current.size).toBe("standard");
    expect(result.current.scale).toBe(1);
  });

  it("persists the choice and applies --reading-scale on <html>", () => {
    const { result } = renderHook(() => useReadingScale({ apply: true }));
    act(() => result.current.setSize("large"));
    expect(window.localStorage.getItem("jlptgo.readingSize")).toBe("large");
    expect(document.documentElement.style.getPropertyValue("--reading-scale"))
      .toBe(String(READING_SCALES.large));
  });

  it("ignores unknown stored values", () => {
    window.localStorage.setItem("jlptgo.readingSize", "huge!");
    const { result } = renderHook(() => useReadingScale());
    expect(result.current.size).toBe("standard");
  });

  it("keeps two hook instances in sync", () => {
    const a = renderHook(() => useReadingScale());
    const b = renderHook(() => useReadingScale());
    act(() => a.result.current.setSize("xlarge"));
    expect(b.result.current.size).toBe("xlarge");
  });
});

describe("ReadingSizeControl", () => {
  it("full variant exposes three radios and selects one", () => {
    render(<ReadingSizeControl />);
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    fireEvent.click(screen.getByRole("radio", { name: "大" }));
    expect(screen.getByRole("radio", { name: "大" })).toBeChecked();
    expect(window.localStorage.getItem("jlptgo.readingSize")).toBe("large");
  });

  it("compact variant cycles standard → large → xlarge → standard", () => {
    render(<ReadingSizeControl compact />);
    const btn = screen.getByRole("button", { name: /题目字号/ });
    fireEvent.click(btn);
    expect(window.localStorage.getItem("jlptgo.readingSize")).toBe("large");
    fireEvent.click(btn);
    expect(window.localStorage.getItem("jlptgo.readingSize")).toBe("xlarge");
    fireEvent.click(btn);
    expect(window.localStorage.getItem("jlptgo.readingSize")).toBe("standard");
  });
});
