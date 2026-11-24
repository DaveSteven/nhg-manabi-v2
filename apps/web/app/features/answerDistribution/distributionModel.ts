import type { AnswerDistribution } from "../../api/dto/answerDistribution";

export const ALL = "all";
/** below this many questions a percentage says little (shown as 样本较少) */
export const SMALL_SAMPLE = 30;

export interface Bar { position: number; count: number; percent: number }
export interface Summary { total: number; bars: Bar[] }

/** Sum counts for a level ("all" = every level) and type ("all" = every type)
 * and turn them into per-position shares. Positions without a single answer
 * are kept up to the highest one seen (so a 4-option set always shows 1–4). */
export function summarize(data: AnswerDistribution, level: string,
                          typeId: string): Summary {
  const byPos = new Map<number, number>();
  for (const c of data.counts) {
    if (level !== ALL && c.level !== level) continue;
    if (typeId !== ALL && c.question_type_id !== typeId) continue;
    byPos.set(c.position, (byPos.get(c.position) ?? 0) + c.count);
  }
  const total = [...byPos.values()].reduce((a, b) => a + b, 0);
  const maxPos = Math.max(0, ...byPos.keys());
  const bars: Bar[] = [];
  for (let p = 1; p <= maxPos; p++) {
    const count = byPos.get(p) ?? 0;
    bars.push({ position: p, count, percent: total ? (count / total) * 100 : 0 });
  }
  return { total, bars };
}

export function formatPercent(v: number): string {
  return `${v.toFixed(1)}%`;
}
