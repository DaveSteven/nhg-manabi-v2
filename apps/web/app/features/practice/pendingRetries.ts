/**
 * Minimal localStorage retry records for in-flight draft edits (M2.2 §7.1).
 * NOTHING beyond {session, question, option, known version, time} is
 * persisted — never answers/explanations, never treated as official
 * state. Server acks clear entries; the array is size-capped.
 */
const KEY = "pending_draft_retries";
const CAP = 200;

export interface PendingRetry {
  sessionId: string;
  questionId: string;
  optionId: string | null;
  knownVersion: number;
  time: string; // ISO
}

function readAll(): PendingRetry[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PendingRetry[]) : [];
  } catch {
    return [];
  }
}

function writeAll(entries: PendingRetry[]): void {
  try {
    window.localStorage.setItem(KEY,
      JSON.stringify(entries.slice(-CAP)));
  } catch {
    // storage unavailable — retry records are best-effort only
  }
}

export function recordPendingRetry(entry: PendingRetry): void {
  const rest = readAll().filter(
    (e) => !(e.sessionId === entry.sessionId && e.questionId === entry.questionId));
  writeAll([...rest, entry]);
}

export function clearPendingRetry(sessionId: string, questionId: string): void {
  writeAll(readAll().filter(
    (e) => !(e.sessionId === sessionId && e.questionId === questionId)));
}

export function loadPendingRetries(sessionId: string): PendingRetry[] {
  return readAll().filter((e) => e.sessionId === sessionId);
}

export function clearSessionPendingRetries(sessionId: string): void {
  writeAll(readAll().filter((e) => e.sessionId !== sessionId));
}
