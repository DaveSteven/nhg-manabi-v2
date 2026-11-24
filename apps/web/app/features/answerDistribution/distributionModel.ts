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

export type Tone = "high" | "low" | "none";
export interface Cell extends Bar { tone: Tone; strength: number }

/** |z| needed before a cell is coloured. ~99%: with dozens of cells on the
 * page a looser cut would colour pure noise (≈5% of cells at 95%). */
export const Z_CUT = 2.58;

/** Colour each option by how far its share is from an even split, but only
 * when the deviation is statistically clear and the sample is not small.
 * Never colours small samples (< SMALL_SAMPLE). strength ∈ (0,1]. */
export function tint(s: Summary): Cell[] {
  const k = s.bars.length;
  return s.bars.map((b) => {
    if (k < 2 || s.total < SMALL_SAMPLE) return { ...b, tone: "none", strength: 0 };
    const p0 = 1 / k;
    const z = (b.count / s.total - p0) / Math.sqrt((p0 * (1 - p0)) / s.total);
    if (Math.abs(z) < Z_CUT) return { ...b, tone: "none", strength: 0 };
    return { ...b, tone: z > 0 ? "high" : "low",
             strength: Math.min((Math.abs(z) - Z_CUT) / 2 + 0.35, 1) };
  });
}
