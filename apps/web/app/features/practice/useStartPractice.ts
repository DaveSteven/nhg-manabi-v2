import { useMutation } from "@tanstack/react-query";
import type { FeedbackMode, PracticeSession } from "../../api/dto/practice";
import { ApiError } from "../../api/errors";
import { createSession, finishSession } from "../../api/endpoints/sessions";

export interface ActiveSessionConflict {
  code: "active_session_exists";
  activeSessionId?: string;
}

export interface StartPracticeInput {
  units: { release_id: string; unit_id: string }[];
  feedbackMode: FeedbackMode;
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
