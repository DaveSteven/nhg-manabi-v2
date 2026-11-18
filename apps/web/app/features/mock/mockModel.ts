import type { MockContentUnit } from "../../api/dto/mock";
import { toViewModel } from "../content/toViewModel";
import { usesSplitLayout } from "../content/SharedMaterialLayout";
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

export interface ExamUnit {
  sessionUnitId: string;
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
      split: usesSplitLayout(vm),
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
