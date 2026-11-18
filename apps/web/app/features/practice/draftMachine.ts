/**
 * Per-question draft state machine (pure reducer, exhaustively testable).
 *
 * Statuses: idle → dirty → saving → saved | save_error | conflict.
 * `rowVersion` is the last SERVER-confirmed version (0 = no draft yet);
 * `optionId` is the server-acked value; `pendingOptionId` is the local
 * edit not yet acknowledged. A new local edit while saving keeps
 * `dirty` so the debounce flushes again afterwards.
 *
 * Server is the source of truth: hydration overwrites local state; the
 * machine NEVER shows "saved" without an ack (design-system state matrix).
 */
export type DraftStatus =
  | "idle"
  | "dirty"
  | "saving"
  | "saved"
  | "save_error"
  | "conflict";

export interface QuestionDraftState {
  status: DraftStatus;
  optionId: string | null; // server-acked selection (null = none/skip)
  pendingOptionId: string | null; // local unacked selection
  rowVersion: number;
  serverOptionId: string | null; // conflict: last known server value
  serverRowVersion: number; // conflict: current_row_version from 409
  errorMessage: string | null;
}

export interface DraftMachineState {
  questions: Record<string, QuestionDraftState>;
}

export type DraftAction =
  | { type: "registered"; questionId: string }
  | { type: "select"; questionId: string; optionId: string }
  | { type: "clear"; questionId: string }
  | { type: "saveStarted"; questionId: string }
  | { type: "saveSucceeded"; questionId: string; optionId: string | null;
      rowVersion: number }
  | { type: "saveFailed"; questionId: string; message: string }
  | { type: "conflict"; questionId: string; serverRowVersion: number }
  | { type: "conflictAdoptServer"; questionId: string; serverOptionId: string | null;
      serverRowVersion: number }
  | { type: "conflictOverwrite"; questionId: string; serverRowVersion: number }
  | { type: "hydrated"; drafts: { questionId: string; optionId: string | null;
      rowVersion: number }[] }
  | { type: "submitted"; questionIds: string[] };

export function initialQuestionState(): QuestionDraftState {
  return {
    status: "idle",
    optionId: null,
    pendingOptionId: null,
    rowVersion: 0,
    serverOptionId: null,
    serverRowVersion: 0,
    errorMessage: null,
  };
}

export function draftReducer(
  state: DraftMachineState,
  action: DraftAction,
): DraftMachineState {
  switch (action.type) {
    case "registered": {
      if (state.questions[action.questionId]) return state;
      return {
        ...state,
        questions: {
          ...state.questions,
          [action.questionId]: initialQuestionState(),
        },
      };
    }

    case "select":
    case "clear": {
      const q = state.questions[action.questionId];
      if (!q || q.status === "conflict") return state; // frozen until resolved
      const optionId = action.type === "select" ? action.optionId : null;
      // Only a settled question may ignore a re-selection of the acked value.
      // While dirty/saving/save_error the user's latest intent differs from
      // (or races with) the server value, so A→B→A must still be recorded.
      if (q.optionId === optionId
          && (q.status === "idle" || q.status === "saved")) {
        return state;
      }
      return {
        ...state,
        questions: {
          ...state.questions,
          [action.questionId]: {
            ...q,
            status: "dirty",
            pendingOptionId: optionId,
            errorMessage: null,
          },
        },
      };
    }

    case "saveStarted": {
      const q = state.questions[action.questionId];
      if (!q || q.status !== "dirty") return state;
      return {
        ...state,
        questions: {
          ...state.questions,
          [action.questionId]: { ...q, status: "saving" },
        },
      };
    }

    case "saveSucceeded": {
      const q = state.questions[action.questionId];
      if (!q) return state;
      // A select/clear that arrived while this save was in flight leaves the
      // question `dirty` (saveStarted is the only way out of dirty→saving), so
      // dirty at ack time means a newer intent exists — including a clear
      // (pending null) — unless it already equals what the server stored.
      const newLocalEdit = q.status === "dirty"
        && q.pendingOptionId !== action.optionId;
      return {
        ...state,
        questions: {
          ...state.questions,
          [action.questionId]: {
            ...q,
            status: newLocalEdit ? "dirty" : "saved",
            optionId: action.optionId,
            rowVersion: action.rowVersion,
            pendingOptionId: newLocalEdit ? q.pendingOptionId : null,
            errorMessage: null,
          },
        },
      };
    }

    case "saveFailed": {
      const q = state.questions[action.questionId];
      if (!q) return state;
      return {
        ...state,
        questions: {
          ...state.questions,
          [action.questionId]: {
            ...q,
            status: "save_error",
            errorMessage: action.message,
          },
        },
      };
    }

    case "conflict": {
      const q = state.questions[action.questionId];
      if (!q) return state;
      return {
        ...state,
        questions: {
          ...state.questions,
          [action.questionId]: {
            ...q,
            status: "conflict",
            serverRowVersion: action.serverRowVersion,
          },
        },
      };
    }

    case "conflictAdoptServer": {
      const q = state.questions[action.questionId];
      if (!q || q.status !== "conflict") return state;
      return {
        ...state,
        questions: {
          ...state.questions,
          [action.questionId]: {
            ...q,
            status: "saved",
            optionId: action.serverOptionId,
            rowVersion: action.serverRowVersion,
            pendingOptionId: null,
            serverOptionId: null,
            serverRowVersion: 0,
            errorMessage: null,
          },
        },
      };
    }

    case "conflictOverwrite": {
      const q = state.questions[action.questionId];
      if (!q || q.status !== "conflict") return state;
      return {
        ...state,
        questions: {
          ...state.questions,
          [action.questionId]: {
            ...q,
            status: "dirty",
            rowVersion: action.serverRowVersion, // fresh version → next save wins
            pendingOptionId: q.pendingOptionId ?? q.optionId,
            serverOptionId: null,
            serverRowVersion: 0,
            errorMessage: null,
          },
        },
      };
    }

    case "hydrated": {
      const questions = { ...state.questions };
      for (const d of action.drafts) {
        questions[d.questionId] = {
          ...initialQuestionState(),
          status: "saved",
          optionId: d.optionId,
          rowVersion: d.rowVersion,
        };
      }
      return { ...state, questions };
    }

    case "submitted": {
      const questions = { ...state.questions };
      for (const id of action.questionIds) {
        const q = questions[id];
        if (q) {
          questions[id] = {
            ...q,
            // Submitted units are locked; keep last known selection.
            status: "saved",
            optionId: q.pendingOptionId ?? q.optionId,
            pendingOptionId: null,
            errorMessage: null,
          };
        }
      }
      return { ...state, questions };
    }

    default:
      return state;
  }
}

/** UI display value: what the user last intended (pending > acked). */
export function displayOptionId(q: QuestionDraftState): string | null {
  // pending only has meaning while an edit is unacked; there null = "cleared".
  return q.status === "dirty" || q.status === "saving" || q.status === "save_error"
    ? q.pendingOptionId : q.optionId;
}

/** Answers for submit: display values; absent questions are skips. */
export function collectAnswers(
  questions: Record<string, QuestionDraftState>,
): { question_id: string; chosen_option_id: string | null }[] {
  return Object.entries(questions).map(([question_id, q]) => ({
    question_id,
    chosen_option_id: displayOptionId(q),
  }));
}

/** Only the answers belonging to the given unit's questions. The draft state
 *  outlives navigation to the next unit's session, and a stale question id
 *  makes the server reject the whole submit (question_not_in_unit). */
export function answersForUnit(
  all: { question_id: string; chosen_option_id: string | null }[],
  questionIds: string[],
): { question_id: string; chosen_option_id: string | null }[] {
  const ids = new Set(questionIds);
  return all.filter((a) => ids.has(a.question_id));
}
