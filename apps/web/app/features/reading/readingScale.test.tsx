import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { ReadingSizeControl } from "./ReadingSizeControl";
import { READING_SCALES, useReadingScale } from "./useReadingScale";

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.style.removeProperty("--reading-scale");
});

describe("useReadingScale", () => {
  it("defaults to step 0 (scale 1)", () => {
    const { result } = renderHook(() => useReadingScale());
    expect(result.current.step).toBe(0);
    expect(result.current.scale).toBe(1);
  });

  it("persists the choice and applies --reading-scale on <html>", () => {
    const { result } = renderHook(() => useReadingScale({ apply: true }));
    act(() => result.current.setStep(3));
    expect(window.localStorage.getItem("jlptgo.readingSize")).toBe("3");
    expect(document.documentElement.style.getPropertyValue("--reading-scale"))
      .toBe(String(READING_SCALES[3]));
  });

  it("ignores unknown stored values and maps legacy names", () => {
    window.localStorage.setItem("jlptgo.readingSize", "huge!");
    expect(renderHook(() => useReadingScale()).result.current.step).toBe(0);
    window.localStorage.setItem("jlptgo.readingSize", "large");
    expect(renderHook(() => useReadingScale()).result.current.step).toBe(2);
  });

  it("keeps two hook instances in sync", () => {
    const a = renderHook(() => useReadingScale());
    const b = renderHook(() => useReadingScale());
    act(() => a.result.current.setStep(4));
    expect(b.result.current.step).toBe(4);
  });
});

describe("ReadingSizeControl", () => {
  const open = () => fireEvent.click(screen.getByRole("button", { name: "字号设置" }));
  const move = (v: string) => fireEvent.change(
    screen.getByRole("slider", { name: "题目字号" }), { target: { value: v } });

  it("slider only previews; the saved size changes on 完成", () => {
    render(<ReadingSizeControl />);
    open();
    expect(screen.getByLabelText("预览")).toBeInTheDocument();
    move("2");
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuetext", "大");
    expect(screen.getByLabelText("预览").style.getPropertyValue("--reading-scale"))
      .toBe(String(READING_SCALES[2]));
    expect(window.localStorage.getItem("jlptgo.readingSize")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "完成" }));
    expect(window.localStorage.getItem("jlptgo.readingSize")).toBe("2");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("取消 / Escape discard the draft", () => {
    window.localStorage.setItem("jlptgo.readingSize", "1");
    render(<ReadingSizeControl compact />);
    fireEvent.click(screen.getByRole("button", { name: "字号" }));
    move("4");
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(window.localStorage.getItem("jlptgo.readingSize")).toBe("1");
    fireEvent.click(screen.getByRole("button", { name: "字号" }));
    move("3");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(window.localStorage.getItem("jlptgo.readingSize")).toBe("1");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("恢复标准 resets the draft only; 完成 saves it", () => {
    window.localStorage.setItem("jlptgo.readingSize", "4");
    render(<ReadingSizeControl />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "恢复标准" }));
    expect(window.localStorage.getItem("jlptgo.readingSize")).toBe("4");
    fireEvent.click(screen.getByRole("button", { name: "完成" }));
    expect(window.localStorage.getItem("jlptgo.readingSize")).toBe("0");
  });
});
