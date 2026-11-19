import type { PracticeSession } from "../../api/dto/practice";

const LABEL = { kanji: "汉字", vocabulary: "词汇", grammar: "语法" } as const;

/** "扩展练习 · 汉字 第 13 课" for a lesson session (ADR-0030). */
export function lessonTitle(
  s: NonNullable<PracticeSession["config"]["supplementary"]>,
): string {
  return `扩展练习 · ${LABEL[s.subject]} 第 ${s.lesson} 课`;
}
