import type { AudioStatus, MockContentUnit } from "../../api/dto/mock";
import { toViewModel } from "../content/toViewModel";
import { layoutModeOf } from "../content/SharedMaterialLayout";
import type { VmContentUnit } from "../content/viewModel";

/** MM:SS, or H:MM:SS once an hour or more is left. Never negative. */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const p = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${p(m)}:${p(s % 60)}` : `${p(m)}:${p(s % 60)}`;
}

/** 分钟 label for the intro page ("105 分钟"); real values only. */
export function minutesLabel(seconds: number | null): string {
  return seconds === null ? "—" : `${Math.round(seconds / 60)} 分钟`;
}

export type TimeTone = "normal" | "warn" | "danger";
/** Colour tier only (no blinking): <=5 min amber, <=1 min red. */
export function timeTone(remaining: number): TimeTone {
  if (remaining <= 60) return "danger";
  if (remaining <= 300) return "warn";
  return "normal";
}

export interface ExamQuestion {
  qid: string;
  sessionUnitId: string;
  unitId: string;
  /** Number shown on the sheet / cards: the paper's printed number. */
  no: string;
  slotId: string | null;
}

/** Visible characters of a richtext payload (sum of its text leaves). */
export function richTextLength(value: unknown): number {
  if (typeof value === "string") return 0;
  if (Array.isArray(value)) return value.reduce((n: number, v) => n + richTextLength(v), 0);
  if (value && typeof value === "object") {
    let n = 0;
    for (const [k, v] of Object.entries(value)) {
      n += k === "text" && typeof v === "string" ? [...v.trim()].length : richTextLength(v);
    }
    return n;
  }
  return 0;
}

/** Longest option (in characters) that still reads well in a 2×2 grid cell:
 * the right-hand panel (~460px → ~12 字 per cell) vs a full-width card. */
export const GRID_MAX_CHARS = { panel: 12, wide: 24 } as const;

/** ADR-0021: 2×2 only when every option is short for the width it gets;
 * otherwise one option per row so Japanese text is never squeezed. */
export function optionColumns(options: { content: unknown }[], inPanel: boolean): 1 | 2 {
  if (options.length < 2) return 1;
  const longest = Math.max(...options.map((o) => richTextLength(o.content)));
  return longest <= (inPanel ? GRID_MAX_CHARS.panel : GRID_MAX_CHARS.wide) ? 2 : 1;
}

export interface ExamUnit {
  sessionUnitId: string;
  /** Server playback status per audio material at load time. */
  audio: Record<string, AudioStatus>;
  vm: VmContentUnit;
  split: boolean;
  hasAudio: boolean;
}

export interface ExamGroup {
  layerId: string;
  label: string;
  subject: string;
  units: ExamUnit[];
  questions: ExamQuestion[];
}

function cleanNo(printed: string | null, fallback: number): string {
  if (!printed) return String(fallback);
  const t = printed.replace(/^0+(?=\d)/, "").replace(/[()（）]/g, "").trim();
  return t || String(fallback);
}

/** The paper's own 大题 structure of the active phase, from real data:
 * units grouped by layer in session order. Nothing is hard-coded. */
export function buildGroups(units: MockContentUnit[]): ExamGroup[] {
  const groups: ExamGroup[] = [];
  let seq = 0;
  for (const u of units) {
    let g = groups.find((x) => x.layerId === u.layer.layer_id);
    if (!g) {
      g = { layerId: u.layer.layer_id,
            label: u.layer.label ?? `大题 ${u.layer.position}`,
            subject: u.layer.subject, units: [], questions: [] };
      groups.push(g);
    }
    const vm = toViewModel(u);
    g.units.push({
      sessionUnitId: u.session_unit_id, vm,
      audio: Object.fromEntries(u.audio.map((a) => [a.material_id, a])),
      split: layoutModeOf(vm) !== "standalone",
      hasAudio: vm.materials.some((m) => m.kind === "audio"),
    });
    for (const q of vm.questions) {
      seq += 1;
      g.questions.push({ qid: q.id, sessionUnitId: u.session_unit_id,
                         unitId: vm.unit.id, slotId: q.slotId,
                         no: cleanNo(q.printedNumber, seq) });
    }
  }
  return groups;
}

// --- 标记待检查: a personal aid, kept on this device only -----------------
const flagKey = (sessionId: string) => `minao-mock-flags:${sessionId}`;

export function loadFlags(sessionId: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(flagKey(sessionId));
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

export function saveFlags(sessionId: string, flags: Set<string>): void {
  try {
    window.localStorage.setItem(flagKey(sessionId), JSON.stringify([...flags]));
  } catch { /* storage full/blocked: flags are best-effort */ }
}

const posKey = (sessionId: string, phaseId: string) =>
  `minao-mock-pos:${sessionId}:${phaseId}`;

export function loadGroupIndex(sessionId: string, phaseId: string): number {
  const n = Number(window.localStorage.getItem(posKey(sessionId, phaseId)));
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

export function saveGroupIndex(sessionId: string, phaseId: string, idx: number): void {
  try { window.localStorage.setItem(posKey(sessionId, phaseId), String(idx)); }
  catch { /* best-effort */ }
}
