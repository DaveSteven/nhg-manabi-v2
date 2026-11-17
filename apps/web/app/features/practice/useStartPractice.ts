import { useMutation } from "@tanstack/react-query";
import type { PracticeSession } from "../../api/dto/practice";
import { ApiError } from "../../api/errors";
import { createQuickSession, finishSession } from "../../api/endpoints/sessions";

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

/** Explicit user action: end a practice session (ended_early keeps the
 * submitted answers; no fabricated result). Never a prerequisite for
 * starting another practice (ADR-0015). */
export function useFinishSession() {
  return useMutation({
    mutationFn: (sessionId: string) => finishSession(sessionId),
  });
}
