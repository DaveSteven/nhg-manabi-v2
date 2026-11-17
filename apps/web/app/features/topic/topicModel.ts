import type { TopicSelection, TopicType } from "../../api/dto/topic";

export const TOPIC_SUBJECTS = [
  { key: "vocabulary", label: "文字词汇" },
  { key: "grammar", label: "文法" },
  { key: "reading", label: "读解" },
  { key: "listening", label: "听力" },
] as const;

export type TopicSubject = (typeof TOPIC_SUBJECTS)[number]["key"];

export function isTopicSubject(v: string | null): v is TopicSubject {
  return TOPIC_SUBJECTS.some((s) => s.key === v);
}

/** Counting word per Canonical unit kind (business-rules: 单题题型显示
 * 「题」，阅读/音频显示「篇/组」). */
export function unitNoun(unitKind: string): string {
  if (unitKind === "single") return "题";
  if (unitKind === "passage" || unitKind === "comparison") return "篇";
  return "组"; // cloze 多题组, audio
}

export const MAX_TOPIC_COUNT = 100;
export const COUNT_PRESETS = [5, 10, 20] as const;

/** wrong_only draws only from Units that are still wrong. */
export function poolSize(t: TopicType, selection: TopicSelection = "smart"): number {
  return selection === "wrong_only" ? t.wrong_units : t.available_units;
}

export function maxCount(t: TopicType, selection: TopicSelection = "smart"): number {
  return Math.min(poolSize(t, selection), MAX_TOPIC_COUNT);
}

/** Default draw size: 10 when available, otherwise everything there is. */
export function defaultCount(t: TopicType, selection: TopicSelection = "smart"): number {
  return Math.min(10, maxCount(t, selection));
}

export type CountCheck = { ok: true } | { ok: false; message: string };

export function checkCount(t: TopicType, raw: number,
                           selection: TopicSelection = "smart"): CountCheck {
  const noun = unitNoun(t.unit_kind);
  const max = maxCount(t, selection);
  if (max < 1) {
    return { ok: false, message: `当前没有仍错的${noun}` };
  }
  if (!Number.isInteger(raw) || raw < 1) {
    return { ok: false, message: `请输入至少 1 ${noun}` };
  }
  if (raw > max) {
    return { ok: false, message: `当前最多可选 ${max} ${noun}` };
  }
  return { ok: true };
}
