import { apiFetch } from "../client";
import { parseDto } from "../dto/exam";
import {
  CreateSessionResponseSchema,
  DraftSaveResultSchema,
  DraftsListSchema,
  FeedbackPayloadSchema,
  FinishResponseSchema,
  PracticeSessionSchema,
  ResultsResponseSchema,
  SubmitResultSchema,
  type DraftSaveResult,
  type DraftsList,
  type FeedbackMode,
  type FeedbackPayload,
  type FinishResponse,
  type PracticeSession,
  type ResultsResponse,
  type SubmitResult,
} from "../dto/practice";

export interface CreateSessionInput {
  feedback_mode: FeedbackMode;
  units: { release_id: string; unit_id: string }[];
}

export function createSession(input: CreateSessionInput,
                              signal?: AbortSignal): Promise<PracticeSession> {
  return apiFetch("/api/practice/sessions",
    { method: "POST", body: input, signal })
    .then((p) => parseDto(CreateSessionResponseSchema, "POST /api/practice/sessions", p));
}

/**
 * 404 with detail "no active practice" is the normal idle state — callers
 * translate it via ApiError (status 404) into "no active session", never
 * an error banner.
 */
export function getCurrentSession(signal?: AbortSignal): Promise<PracticeSession> {
  return apiFetch("/api/practice/sessions/current", { signal })
    .then((p) => parseDto(PracticeSessionSchema, "GET /api/practice/sessions/current", p));
}

export function getSession(sessionId: string,
                           signal?: AbortSignal): Promise<PracticeSession> {
  return apiFetch(`/api/practice/sessions/${encodeURIComponent(sessionId)}`, { signal })
    .then((p) => parseDto(PracticeSessionSchema, `GET session ${sessionId}`, p));
}

export interface SaveDraftInput {
  session_unit_id: string;
  question_id: string;
  chosen_option_id: string | null;
  expected_row_version: number; // 0 = no draft saved yet
}

export function saveDraft(sessionId: string, input: SaveDraftInput,
                          signal?: AbortSignal): Promise<DraftSaveResult> {
  return apiFetch(
    `/api/practice/sessions/${encodeURIComponent(sessionId)}/units/${encodeURIComponent(input.session_unit_id)}/drafts`,
    { method: "PUT",
      body: { question_id: input.question_id,
              chosen_option_id: input.chosen_option_id,
              expected_row_version: input.expected_row_version },
      signal })
    .then((p) => parseDto(DraftSaveResultSchema, "PUT drafts", p));
}

export function getDrafts(sessionId: string,
                          signal?: AbortSignal): Promise<DraftsList> {
  return apiFetch(
    `/api/practice/sessions/${encodeURIComponent(sessionId)}/drafts`, { signal })
    .then((p) => parseDto(DraftsListSchema, "GET drafts", p));
}

export interface SubmitUnitInput {
  session_unit_id: string;
  /** Absent questions count as skip; null chosen_option_id = explicit skip. */
  answers: { question_id: string; chosen_option_id: string | null }[];
}

export function submitUnit(sessionId: string, input: SubmitUnitInput,
                           signal?: AbortSignal): Promise<SubmitResult> {
  return apiFetch(
    `/api/practice/sessions/${encodeURIComponent(sessionId)}/units/${encodeURIComponent(input.session_unit_id)}/submit`,
    { method: "POST", body: { answers: input.answers }, signal })
    .then((p) => parseDto(SubmitResultSchema, "POST submit", p));
}

export function getUnitFeedback(sessionId: string, sessionUnitId: string,
                                signal?: AbortSignal): Promise<FeedbackPayload> {
  return apiFetch(
    `/api/practice/sessions/${encodeURIComponent(sessionId)}/units/${encodeURIComponent(sessionUnitId)}/feedback`,
    { signal })
    .then((p) => parseDto(FeedbackPayloadSchema, "GET feedback", p));
}

export function finishSession(sessionId: string,
                              signal?: AbortSignal): Promise<FinishResponse> {
  return apiFetch(`/api/practice/sessions/${encodeURIComponent(sessionId)}/finish`,
    { method: "POST", signal })
    .then((p) => parseDto(FinishResponseSchema, "POST finish", p));
}

export function getSessionResults(sessionId: string,
                                  signal?: AbortSignal): Promise<ResultsResponse> {
  return apiFetch(`/api/practice/sessions/${encodeURIComponent(sessionId)}/results`,
    { signal })
    .then((p) => parseDto(ResultsResponseSchema, "GET results", p));
}
