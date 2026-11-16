import type { StudyResults } from "../../api/dto/practice";

export interface ResultsSummary {
  correct: number;
  wrong: number;
  skipped: number;
  total: number;
  /** Score rate over all questions (0–1), formatted for display. */
  scoreRatePercent: string;
  /** Accuracy over actually-answered questions; null when none answered. */
  answeredAccuracyPercent: string | null;
}

/**
 * Pure helpers over the results payload. Enforces the statistical
 * identity correct + wrong + skipped === total — the backend has a DB
 * CHECK; this guards against client-side drift.
 */
export function summarizeResults(results: StudyResults): ResultsSummary {
  const { correct_count, wrong_count, skipped_count, total_count } = results;
  if (correct_count + wrong_count + skipped_count !== total_count) {
    throw new Error(
      `results identity violated: ${correct_count}+${wrong_count}+`
      + `${skipped_count} != ${total_count}`);
  }
  return {
    correct: correct_count,
    wrong: wrong_count,
    skipped: skipped_count,
    total: total_count,
    scoreRatePercent: formatPercent(results.score_rate),
    answeredAccuracyPercent: results.answered_accuracy === null
      ? null
      : formatPercent(results.answered_accuracy),
  };
}

function formatPercent(rate: number): string {
  return `${Math.round(rate * 1000) / 10}%`;
}

export function resultVerdict(q: { is_correct: boolean | null;
                                   skipped: boolean }): "correct" | "wrong" | "skipped" {
  if (q.skipped || q.is_correct === null) return "skipped";
  return q.is_correct ? "correct" : "wrong";
}
