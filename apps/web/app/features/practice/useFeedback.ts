import { useQuery } from "@tanstack/react-query";
import type { FeedbackMode, FeedbackPayload } from "../../api/dto/practice";
import { ApiError } from "../../api/errors";
import { getUnitFeedback } from "../../api/endpoints/sessions";

/**
 * Feedback permission gate (backend is the authorization boundary; the
 * frontend adds a request-level gate so unified-feedback sessions NEVER
 * even issue a feedback request before finish):
 * - immediate: only after that unit is formally submitted;
 * - end: nothing before session.state !== "in_progress".
 * Wire-level tests assert zero feedback requests in the end mode before
 * finish; real leak prevention is enforced by the backend.
 */
export function useFeedback(sessionId: string, sessionUnitId: string,
                            mode: FeedbackMode, opts: {
                              unitSubmitted: boolean;
                              sessionEnded: boolean;
                            }) {
  const allowed = opts.unitSubmitted
    && (mode === "immediate" || opts.sessionEnded);
  return useQuery<FeedbackPayload, ApiError>({
    queryKey: ["feedback", sessionId, sessionUnitId],
    queryFn: ({ signal }) => getUnitFeedback(sessionId, sessionUnitId, signal),
    enabled: allowed,
    retry: 0,
    staleTime: Infinity,
  });
}
