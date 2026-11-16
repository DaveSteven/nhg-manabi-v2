import type { ExamOutline, ExamSummary, OutlineSection } from "../../api/dto/exam";

/** Semantic subject labels (Canonical question_types.subject → display). */
const SUBJECT_LABELS: Record<string, string> = {
  vocabulary: "文字词汇",
  grammar: "文法",
  reading: "读解",
  listening: "听力",
};

export function subjectLabel(subject: string): string {
  return SUBJECT_LABELS[subject] ?? subject;
}

/**
 * Sections render in server order (release_sections.position) — never
 * re-derived from array indices. This helper only decorates for display.
 */
export function decorateSections(outline: ExamOutline): OutlineSection[] {
  return outline.sections;
}

export function examTitle(exam: Pick<ExamSummary, "year" | "month" | "level">): string {
  return `${exam.year}年${exam.month}月 ${exam.level}`;
}

export function examRoute(examId: string): string {
  return `/study/exams/${encodeURIComponent(examId)}`;
}
