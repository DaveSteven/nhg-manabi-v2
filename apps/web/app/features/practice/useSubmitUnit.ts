import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SubmitResult } from "../../api/dto/practice";
import { ApiError } from "../../api/errors";
import { getSession, submitUnit } from "../../api/endpoints/sessions";

export interface SubmitAnswersInput {
  sessionUnitId: string;
  answers: { question_id: string; chosen_option_id: string | null }[];
}

export type SubmitOutcome =
  | { kind: "submitted"; result: SubmitResult }
  | { kind: "alreadySubmitted" } // timeout path: server says unit already submitted
  | { kind: "failed"; error: ApiError };

/**
 * Unit submit. On network failure the FIRST action is querying the
 * session's unit state: if already `submitted`, the stored outcome is
 * adopted (server-side idempotency via state short-circuit/locks/unique
 * constraints — there is NO Idempotency-Key header); only a still-pending
 * unit may be retried explicitly. Local request IDs are log-correlation
 * only and never presented as server idempotency keys.
 */
export function useSubmitUnit(
  sessionId: string,
  onSettled: (outcome: SubmitOutcome) => void,
) {
  const queryClient = useQueryClient();
  return useMutation<SubmitResult, ApiError, SubmitAnswersInput>({
    mutationFn: (input) => submitUnit(sessionId, {
      session_unit_id: input.sessionUnitId,
      answers: input.answers,
    }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["session-bundle", sessionId] });
      onSettled({ kind: "submitted", result });
    },
    onError: async (error, variables) => {
      if (error.status === 0 || error.code === "network_error") {
        // Timeout / dropped connection: query unit state before any retry.
        try {
          const session = await getSession(sessionId);
          const unit = session.units.find((u) => u.id === variables.sessionUnitId);
          if (unit?.state === "submitted") {
            void queryClient.invalidateQueries({ queryKey: ["session-bundle", sessionId] });
            onSettled({ kind: "alreadySubmitted" });
            return;
          }
        } catch {
          // state check failed — fall through to explicit failure
        }
      }
      onSettled({ kind: "failed", error });
    },
  });
}
