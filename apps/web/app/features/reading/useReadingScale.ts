import { useCallback, useEffect, useSyncExternalStore } from "react";

/**
 * Reading-content size preference (ADR-0034). Scales only the question
 * content (`.richtext`: stems, options, materials, explanations); UI chrome
 * keeps its fixed sizes. Five snapped steps, stored per device in
 * localStorage; not synced to the server.
 */
export const READING_STEPS = [0, 1, 2, 3, 4] as const;
export type ReadingStep = (typeof READING_STEPS)[number];

export const READING_SCALES: Record<ReadingStep, number> = {
  0: 1, 1: 1.125, 2: 1.25, 3: 1.375, 4: 1.5,
};

export const READING_STEP_LABELS: Record<ReadingStep, string> = {
  0: "标准", 1: "稍大", 2: "大", 3: "特大", 4: "超大",
};

const KEY = "jlptgo.readingSize";
// first iteration stored names; keep those users' choice
const LEGACY: Record<string, ReadingStep> = { standard: 0, large: 2, xlarge: 3 };
const listeners = new Set<() => void>();

function read(): ReadingStep {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw !== null && raw in LEGACY) return LEGACY[raw]!;
    return READING_STEPS.find((s) => String(s) === raw) ?? 0;
  } catch {
    return 0;
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

export function useReadingScale(opts: { apply?: boolean } = {}): {
  step: ReadingStep;
  scale: number;
  setStep: (step: ReadingStep) => void;
} {
  const step = useSyncExternalStore(subscribe, read, () => 0 as ReadingStep);

  const setStep = useCallback((next: ReadingStep) => {
    try {
      window.localStorage.setItem(KEY, String(next));
    } catch {
      // storage unavailable: still notify so this tab updates for the session
    }
    listeners.forEach((l) => l());
  }, []);

  const apply = opts.apply ?? false;
  useEffect(() => {
    if (!apply) return;
    document.documentElement.style.setProperty(
      "--reading-scale", String(READING_SCALES[step]));
  }, [apply, step]);

  return { step, scale: READING_SCALES[step], setStep };
}
