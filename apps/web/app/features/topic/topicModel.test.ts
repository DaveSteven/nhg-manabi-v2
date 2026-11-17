import { describe, expect, it } from "vitest";
import type { TopicType } from "../../api/dto/topic";
import { checkCount, defaultCount, maxCount, unitNoun } from "./topicModel";

const t = (over: Partial<TopicType> = {}): TopicType => ({
  question_type_id: "vocabulary_kanji_reading", subject: "vocabulary",
  label_zh: "汉字读音", label_ja: "漢字読み", unit_kind: "single",
  is_provisional: false, available_units: 30, available_questions: 30,
  new_units: 30, ...over,
});

describe("topicModel", () => {
  it("counting word follows the Canonical unit kind", () => {
    expect(unitNoun("single")).toBe("题");
    expect(unitNoun("passage")).toBe("篇");
    expect(unitNoun("comparison")).toBe("篇");
    expect(unitNoun("cloze")).toBe("组");
    expect(unitNoun("audio")).toBe("组");
  });

  it("default count is 10 or everything available; max capped at 100", () => {
    expect(defaultCount(t())).toBe(10);
    expect(defaultCount(t({ available_units: 4 }))).toBe(4);
    expect(maxCount(t({ available_units: 500 }))).toBe(100);
  });

  it("flags zero, fractional and over-limit counts with the right noun", () => {
    expect(checkCount(t(), 10)).toEqual({ ok: true });
    expect(checkCount(t(), 0).ok).toBe(false);
    expect(checkCount(t(), 2.5).ok).toBe(false);
    expect(checkCount(t(), Number.NaN).ok).toBe(false);
    const over = checkCount(t({ unit_kind: "passage", available_units: 8 }), 9);
    expect(over).toEqual({ ok: false, message: "当前最多可选 8 篇" });
  });
});
