/** Ratio → percent text; null means "no denominator", shown as a dash. */
export const pct = (v: number | null) =>
  v === null ? '—' : `${Math.round(v * 1000) / 10}%`
