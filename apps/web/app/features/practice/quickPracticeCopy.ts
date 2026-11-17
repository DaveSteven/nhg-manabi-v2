import type { ExamOutline } from "../../api/dto/exam";

/**
 * Quick Practice copy (quick-practice.md v2.1 §6/§7): users think in real
 * JLPT paper structures (問題1-3, 一道题 / 一组 / 一篇), never in the
 * database's Unit/Session terms. Copy derives from the Canonical unit kind
 * and question count — real distribution (dev DB): single 独立单题 /
 * cloze+comparison 文法多题组 / passage 阅读文章 / audio 听力（以单题为主）.
 */
export interface QuickPracticeCopy {
  /** 提交答案 · 提交本组 · 提交本篇 */
  submitLabel: string;
  /** 下一题 · 下一组 · 下一篇 — always the next unit in EXAM order */
  nextLabel: string;
}

export function quickPracticeCopy(unitKind: string,
                                  questionCount: number): QuickPracticeCopy {
  // Reading article: 提交本篇 / 下一篇 regardless of question count
  // (a one-question passage unit is still 一篇).
  if (unitKind === "passage") {
    return { submitLabel: "提交本篇", nextLabel: "下一篇" };
  }
  // Grammar multi-question groups (cloze slots, comparison sets):
  // 提交本组 / 下一组.
  if (questionCount > 1) {
    return { submitLabel: "提交本组", nextLabel: "下一组" };
  }
  // Independent single question (incl. single-question listening units):
  // 提交答案 / 下一题.
  return { submitLabel: "提交答案", nextLabel: "下一题" };
}

/**
 * The unit's real position in the paper, e.g. 問題1-3 — outline layer label
 * + unit position (units carry no label in the content data). Same fallback
 * the exam outline rows use, so the practice page title always matches the
 * row the user clicked.
 */
export function outlineUnitLabel(outline: ExamOutline,
                                 unitId: string): string | null {
  for (const section of outline.sections) {
    for (const layer of section.layers) {
      const unit = layer.units.find((u) => u.unit_id === unitId);
      if (unit) {
        return unit.label
          ?? `${layer.display_label ?? `大题 ${layer.position}`}-${unit.position}`;
      }
    }
  }
  return null;
}
