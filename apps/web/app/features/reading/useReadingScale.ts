import { useCallback, useEffect, useSyncExternalStore } from "react";

/**
 * Reading-content size preference (ADR-0034). Scales only the question
 * content (`.richtext`: stems, options, materials, explanations); UI chrome
 * keeps its fixed sizes. Stored per device in localStorage; not synced.
 */
export const READING_SIZES = ["standard", "large", "xlarge"] as const;
export type ReadingSize = (typeof READING_SIZES)[number];

export const READING_SCALES: Record<ReadingSize, number> = {
  standard: 1,
  large: 1.125,
  xlarge: 1.25,
};

export const READING_SIZE_LABELS: Record<ReadingSize, string> = {
  standard: "标准",
  large: "大",
  xlarge: "特大",
};

const KEY = "jlptgo.readingSize";
const listeners = new Set<() => void>();

function read(): ReadingSize {
  try {
    const raw = window.localStorage.getItem(KEY);
    return READING_SIZES.find((s) => s === raw) ?? "standard";
  } catch {
    return "standard";
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
  size: ReadingSize;
  scale: number;
  setSize: (size: ReadingSize) => void;
} {
  const size = useSyncExternalStore(subscribe, read, () => "standard" as const);

  const setSize = useCallback((next: ReadingSize) => {
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      // storage unavailable: still notify so this tab updates for the session
    }
    listeners.forEach((l) => l());
  }, []);

  const apply = opts.apply ?? false;
  useEffect(() => {
    if (!apply) return;
    document.documentElement.style.setProperty(
      "--reading-scale", String(READING_SCALES[size]));
  }, [apply, size]);

  return { size, scale: READING_SCALES[size], setSize };
}
