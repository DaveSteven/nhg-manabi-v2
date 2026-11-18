import { describe, expect, it } from "vitest";
import { formatClock, minutesLabel, optionColumns, richTextLength, timeTone } from "./mockModel";

describe("mock clock helpers", () => {
  it("formats MM:SS under an hour and H:MM:SS above, never negative", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(-5)).toBe("00:00");
    expect(formatClock(65)).toBe("01:05");
    expect(formatClock(3599)).toBe("59:59");
    expect(formatClock(3600)).toBe("1:00:00");
    expect(formatClock(6300)).toBe("1:45:00");
  });
  it("uses a colour tier near the end (no blinking tier)", () => {
    expect(timeTone(301)).toBe("normal");
    expect(timeTone(300)).toBe("warn");
    expect(timeTone(61)).toBe("warn");
    expect(timeTone(60)).toBe("danger");
  });
  it("shows real minutes, — when unknown", () => {
    expect(minutesLabel(6300)).toBe("105 分钟");
    expect(minutesLabel(null)).toBe("—");
  });
});

const rt = (text: string) => ({ format: "jlptgo-richtext-v1", blocks: [
  { type: "paragraph", children: [{ type: "text", text }] }] });

describe("option columns (ADR-0021)", () => {
  it("counts visible characters only", () => {
    expect(richTextLength(rt("八才さん"))).toBe(4);
    expect(richTextLength(null)).toBe(0);
  });
  it("2×2 only when every option is short for its width", () => {
    const names = ["八才さん", "中村さん", "マットさん", "西田さん"].map((t) => ({ content: rt(t) }));
    expect(optionColumns(names, true)).toBe(2);
    const reading = ["気持ちや考えを伝えるときに使える言葉をたくさん知っていたほうがいい。", "短い"]
      .map((t) => ({ content: rt(t) }));
    expect(optionColumns(reading, true)).toBe(1);
    expect(optionColumns(reading, false)).toBe(1);
    const mid = ["十六文字くらいの選択肢の文です", "短い"].map((t) => ({ content: rt(t) }));
    expect(optionColumns(mid, true)).toBe(1);   // too long for a panel cell
    expect(optionColumns(mid, false)).toBe(2);  // fine in a full-width card
  });
});
