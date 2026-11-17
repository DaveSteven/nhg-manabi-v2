import { useMutation } from "@tanstack/react-query";
import type { FeedbackMode, PracticeSession } from "../../api/dto/practice";
import { ApiError } from "../../api/errors";
import { createSession, createQuickSession, finishSession } from "../../api/endpoints/sessions";

/**
 * Quick Practice start (quick-practice.md v2.0): click a unit → the
 * backend creates a `quick_practice` session (own mode — 专项练习 sessions
 * are never touched) and the caller navigates straight into it. No
 * conflict dialog: a stale quick session is silently replaced server-side,
 * and a 409 can only mean a concurrent double-click race — the winner is
 * a fresh session for the same unit, so one retry suffices.
 */
export function useQuickPracticeStart(
  onStarted: (session: PracticeSession) => void,
) {
  return useMutation<PracticeSession, ApiError,
                     { release_id: string; unit_id: string }>({
    mutationFn: (input) => createQuickSession(input),
    retry: (failureCount, error) => failureCount < 1 && error.status === 409,
    onSuccess: onStarted,
  });
}

export interface ActiveSessionConflict {
  code: "active_session_exists";
  activeSessionId?: string;
}

export interface StartPracticeInput {
  units: { release_id: string; unit_id: string }[];
  feedbackMode: FeedbackMode;
  /** Quick Practice: atomic end-old + create-new in one transaction. */
  replaceActive?: boolean;
}

/**
 * Create a normal practice session. A 409 active_session_exists surfaces
 * as a conflict result — the UI must offer 继续/结束旧练习 (P-010), never
 * silently replace.
 */
export function useStartPractice(onSuccess: (session: PracticeSession) => void) {
  return useMutation<PracticeSession, ApiError, StartPracticeInput>({
    mutationFn: (input) => createSession({
      feedback_mode: input.feedbackMode,
      units: input.units,
      replace_active: input.replaceActive ?? false,
    }),
    onSuccess,
  });
}

export function isConflict(err: ApiError): ActiveSessionConflict | null {
  if (err.status === 409 && err.code === "active_session_exists") {
    return {
      code: "active_session_exists",
      activeSessionId: typeof err.details.active_session_id === "string"
        ? err.details.active_session_id
        : undefined,
    };
  }
  return null;
}

/** 结束旧练习后再开始: finish first (may produce ended_early), caller
 * retries creation afterwards. */
export function useFinishSession() {
  return useMutation({
    mutationFn: (sessionId: string) => finishSession(sessionId),
  });
}
