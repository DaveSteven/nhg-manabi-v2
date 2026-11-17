import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { ApiError } from "../../api/errors";
import { saveDraft } from "../../api/endpoints/sessions";
import {
  collectAnswers,
  draftReducer,
  displayOptionId,
  initialQuestionState,
  type DraftMachineState,
} from "./draftMachine";
import { clearPendingRetry, recordPendingRetry } from "./pendingRetries";

const AUTOSAVE_DEBOUNCE_MS = 800;

export interface DraftConflict {
  questionId: string;
  serverRowVersion: number;
}

export interface DraftManagerApi {
  state: DraftMachineState;
  registerQuestions(questionIds: string[]): void;
  hydrate(drafts: { questionId: string; optionId: string | null;
                    rowVersion: number }[]): void;
  select(questionId: string, optionId: string): void;
  clear(questionId: string): void;
  markSubmitted(questionIds: string[]): void;
  adoptServer(questionId: string, serverOptionId: string | null,
              serverRowVersion: number): void;
  overwriteAfterConflict(questionId: string, serverRowVersion: number): void;
  answers(): { question_id: string; chosen_option_id: string | null }[];
  displayValue(questionId: string): string | null;
  conflicts: DraftConflict[];
  flushPending(): void;
}

/**
 * Binds the draft state machine to the drafts API: debounced merged
 * autosave carrying expected_row_version; 409 draft_version_conflict →
 * refetch server drafts and freeze the question in `conflict` until the
 * user chooses (adopt server / overwrite with the fresh version). Never
 * silently overwrites; "saved" is only ever shown after a server ack.
 *
 * `persist: false` (Quick Practice) keeps selections in pure React state:
 * no PUT /drafts calls, no hydrate, no conflicts — unsubmitted choices
 * reset on refresh/leave by design (quick-practice.md v2.0 §2).
 */
export function useDraftManager(sessionId: string,
                                sessionUnitId: string,
                                opts?: {
                                  persist?: boolean;
                                  /** Which session unit owns a question — lets one
                                   * manager save drafts across ALL units (统一反馈
                                   * navigates questions of every unit). */
                                  unitOf?: (questionId: string) => string | undefined;
                                }): DraftManagerApi {
  const persist = opts?.persist ?? true;
  const unitOfRef = useRef(opts?.unitOf);
  unitOfRef.current = opts?.unitOf;
  const [state, dispatch] = useReducer(draftReducer, { questions: {} });
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const pending = timers.current;
    return () => {
      Object.values(pending).forEach(clearTimeout);
    };
  }, []);

  const flushQuestion = useCallback((questionId: string) => {
    const q = stateRef.current.questions[questionId];
    if (!q || q.status !== "dirty") return;
    dispatch({ type: "saveStarted", questionId });
    saveDraft(sessionId, {
      session_unit_id: unitOfRef.current?.(questionId) ?? sessionUnitId,
      question_id: questionId,
      chosen_option_id: q.pendingOptionId,
      expected_row_version: q.rowVersion,
    }).then((result) => {
      dispatch({ type: "saveSucceeded", questionId,
                 optionId: result.chosen_option_id, rowVersion: result.row_version });
      clearPendingRetry(sessionId, questionId);
    }).catch((cause: unknown) => {
      if (cause instanceof ApiError
          && cause.code === "draft_version_conflict") {
        const serverVersion = typeof cause.details.current_row_version === "number"
          ? cause.details.current_row_version : 0;
        dispatch({ type: "conflict", questionId, serverRowVersion: serverVersion });
      } else if (cause instanceof ApiError && cause.status === 409) {
        // unit_locked etc. — treated as conflict-freeze for user choice
        dispatch({ type: "conflict", questionId, serverRowVersion: q.rowVersion });
      } else {
        dispatch({ type: "saveFailed", questionId,
                   message: cause instanceof Error ? cause.message : "保存失败" });
        recordPendingRetry({
          sessionId, questionId,
          optionId: q.pendingOptionId,
          knownVersion: q.rowVersion,
          time: new Date().toISOString(),
        });
      }
    });
  }, [sessionId, sessionUnitId]);

  const schedule = useCallback((questionId: string) => {
    if (!persist) return; // Quick Practice: local-only selections
    clearTimeout(timers.current[questionId]);
    timers.current[questionId] = setTimeout(
      () => flushQuestion(questionId), AUTOSAVE_DEBOUNCE_MS);
  }, [flushQuestion, persist]);

  const select = useCallback((questionId: string, optionId: string) => {
    dispatch({ type: "select", questionId, optionId });
    schedule(questionId);
  }, [schedule]);

  const clear = useCallback((questionId: string) => {
    dispatch({ type: "clear", questionId });
    schedule(questionId);
  }, [schedule]);

  const adoptServer = useCallback((questionId: string, serverOptionId: string | null,
                                   serverRowVersion: number) => {
    dispatch({ type: "conflictAdoptServer", questionId, serverOptionId,
               serverRowVersion });
    clearPendingRetry(sessionId, questionId);
  }, [sessionId]);

  const overwriteAfterConflict = useCallback((questionId: string,
                                              serverRowVersion: number) => {
    dispatch({ type: "conflictOverwrite", questionId, serverRowVersion });
    schedule(questionId);
  }, [schedule]);

  const flushPending = useCallback(() => {
    if (!persist) return;
    for (const [questionId, q] of Object.entries(stateRef.current.questions)) {
      if (q.status === "dirty") flushQuestion(questionId);
    }
  }, [flushQuestion, persist]);

  const conflicts = useMemo(
    () => Object.entries(state.questions)
      .filter(([, q]) => q.status === "conflict")
      .map(([questionId, q]) => ({
        questionId, serverRowVersion: q.serverRowVersion })),
    [state.questions],
  );

  return {
    state,
    registerQuestions: useCallback((questionIds: string[]) => {
      for (const id of questionIds) dispatch({ type: "registered", questionId: id });
    }, []),
    hydrate: useCallback((drafts) => dispatch({ type: "hydrated", drafts }), []),
    select,
    clear,
    markSubmitted: useCallback((questionIds: string[]) =>
      dispatch({ type: "submitted", questionIds }), []),
    adoptServer,
    overwriteAfterConflict,
    answers: useCallback(() => collectAnswers(stateRef.current.questions), []),
    displayValue: useCallback((questionId: string) => {
      const q = stateRef.current.questions[questionId];
      return q ? displayOptionId(q) : null;
    }, []),
    conflicts,
    flushPending,
  };
}

export { initialQuestionState };
