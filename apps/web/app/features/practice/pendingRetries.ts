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

export interface RetryServerDraft {
  questionId: string;
  optionId: string | null;
  rowVersion: number;
}

export interface RetryRestoreTarget {
  select(questionId: string, optionId: string): void;
  clear(questionId: string): void;
}

/**
 * Re-apply failed-save intents after a refresh, per question and limited to
 * `scope` (the questions this view hydrated — other units/phases keep their
 * records). `knownVersion` is the last server-confirmed version when the save
 * failed, so an unchanged server (same version) means the intent never
 * landed and is restored as a normal dirty edit (including first answers,
 * 0/0, and explicit clears). A moved server version means the draft changed
 * elsewhere (or our request landed and only the response was lost): the
 * server wins and the stale record is dropped — never a silent overwrite.
 */
export function restorePendingRetries(
  sessionId: string,
  server: RetryServerDraft[],
  target: RetryRestoreTarget,
  scope: ReadonlySet<string>,
): void {
  for (const retry of loadPendingRetries(sessionId)) {
    if (!scope.has(retry.questionId)) continue;
    const s = server.find((d) => d.questionId === retry.questionId);
    const serverVersion = s ? s.rowVersion : 0;
    const serverOption = s ? s.optionId : null;
    if (retry.knownVersion !== serverVersion || retry.optionId === serverOption) {
      clearPendingRetry(sessionId, retry.questionId);
      continue;
    }
    if (retry.optionId === null) target.clear(retry.questionId);
    else target.select(retry.questionId, retry.optionId);
  }
}
