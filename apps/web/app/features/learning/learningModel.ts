import type { LearningSubject } from "../../api/dto/learning";

export const LEARNING_TABS = [
  { key: "overview", label: "学习概览" },
  { key: "history", label: "练习历史" },
  { key: "records", label: "题目记录" },
] as const;
export type LearningTab = (typeof LEARNING_TABS)[number]["key"];

export function isLearningTab(v: string | null): v is LearningTab {
  return LEARNING_TABS.some((t) => t.key === v);
}

export const SUBJECT_LABEL: Record<LearningSubject, string> = {
  vocabulary: "文字词汇", grammar: "文法", reading: "读解", listening: "听力",
};

/** “—” when there is nothing to divide — never a fake 0% (business-rules). */
export function formatPercent(ratio: number | null): string {
  return ratio === null ? "—" : `${Math.round(ratio * 100)}%`;
}

export const RECORD_FILTERS = [
  { key: "ever_wrong", label: "曾经答错" },
  { key: "still_wrong", label: "最近仍错" },
  { key: "recovered", label: "最近已答对" },
] as const;

export function formatDate(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export const PAGE_SIZE = 10;

/** Semantic tone for an answered-accuracy value (statuses keep their own
 * colors, design-system §2.3). null (“—”) stays neutral, never red. */
export type AccuracyTone = "good" | "mid" | "bad" | "none";
export function accuracyTone(ratio: number | null): AccuracyTone {
  if (ratio === null) return "none";
  if (ratio >= 0.8) return "good";
  if (ratio >= 0.6) return "mid";
  return "bad";
}
