/**
 * Official JLPT test sittings used by the home countdown. Dates are the
 * public Japan-site sitting dates (the Sunday of each sitting) and must be
 * extended by hand when new sittings are announced; past ones drop out
 * automatically. This is display data only — nothing else depends on it.
 */
export interface ExamSitting {
  /** ISO calendar date, local to the learner. */
  date: string;
  label: string;
}

export const EXAM_SITTINGS: ExamSitting[] = [
  { date: "2026-07-05", label: "JLPT 夏季统考" },
  { date: "2026-12-06", label: "JLPT 冬季统考" },
];

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

function parseLocal(iso: string): Date {
  const [y = 0, m = 1, d = 1] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** The next sitting on or after `now` and the whole days until it. */
export function nextSitting(now: Date, sittings = EXAM_SITTINGS):
  { sitting: ExamSitting; daysLeft: number; text: string } | null {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (const sitting of sittings) {
    const d = parseLocal(sitting.date);
    const daysLeft = Math.round((d.getTime() - today.getTime()) / 86_400_000);
    if (daysLeft >= 0) {
      return { sitting, daysLeft,
               text: `${d.getMonth() + 1}月${d.getDate()}日 周${WEEKDAYS[d.getDay()]}` };
    }
  }
  return null;
}
