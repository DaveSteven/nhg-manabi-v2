import { apiFetch } from "../client";
import { parseDto } from "../dto/exam";
import { DraftSaveResultSchema, DraftsListSchema,
         type DraftSaveResult, type DraftsList } from "../dto/practice";
import { AudioStatusSchema, MockAvailabilitySchema, MockContentSchema, MockResultsSchema,
         MockStateSchema, type MockAvailability, type MockContent,
         type AudioStatus, type MockResults, type MockState } from "../dto/mock";
import type { SaveDraftInput } from "./sessions";

const enc = encodeURIComponent;

export function getMockAvailability(examId: string,
                                    signal?: AbortSignal): Promise<MockAvailability> {
  return apiFetch(`/api/exams/${enc(examId)}/mock`, { signal })
    .then((p) => parseDto(MockAvailabilitySchema, `GET exam ${examId} mock`, p));
}

export function createMock(examId: string, replaceActive = false,
                           signal?: AbortSignal): Promise<MockState> {
  return apiFetch("/api/mock-exams", {
    method: "POST", signal,
    body: { exam_id: examId, replace_active: replaceActive },
  }).then((p) => parseDto(MockStateSchema, "POST /api/mock-exams", p));
}

/** 404 = no running mock (normal idle state, not an error banner). */
export function getCurrentMock(signal?: AbortSignal): Promise<MockState> {
  return apiFetch("/api/mock-exams/current", { signal })
    .then((p) => parseDto(MockStateSchema, "GET mock current", p));
}

export function getMock(sessionId: string, signal?: AbortSignal): Promise<MockState> {
  return apiFetch(`/api/mock-exams/${enc(sessionId)}`, { signal })
    .then((p) => parseDto(MockStateSchema, `GET mock ${sessionId}`, p));
}

export function getMockContent(sessionId: string,
                               signal?: AbortSignal): Promise<MockContent> {
  return apiFetch(`/api/mock-exams/${enc(sessionId)}/content`, { signal })
    .then((p) => parseDto(MockContentSchema, "GET mock content", p));
}

export function getMockDrafts(sessionId: string,
                              signal?: AbortSignal): Promise<DraftsList> {
  return apiFetch(`/api/mock-exams/${enc(sessionId)}/drafts`, { signal })
    .then((p) => parseDto(DraftsListSchema, "GET mock drafts", p));
}

export function saveMockDraft(sessionId: string, input: SaveDraftInput,
                              signal?: AbortSignal): Promise<DraftSaveResult> {
  return apiFetch(
    `/api/mock-exams/${enc(sessionId)}/units/${enc(input.session_unit_id)}/drafts`,
    { method: "PUT", signal,
      body: { question_id: input.question_id,
              chosen_option_id: input.chosen_option_id,
              expected_row_version: input.expected_row_version } })
    .then((p) => parseDto(DraftSaveResultSchema, "PUT mock drafts", p));
}

export interface PhaseAnswer {
  session_unit_id: string;
  question_id: string;
  chosen_option_id: string | null;
}

export function submitMockPhase(sessionId: string, phaseId: string,
                                answers: PhaseAnswer[],
                                signal?: AbortSignal): Promise<MockState> {
  return apiFetch(
    `/api/mock-exams/${enc(sessionId)}/phases/${enc(phaseId)}/submit`,
    { method: "POST", body: { answers }, signal })
    .then((p) => parseDto(MockStateSchema, "POST mock phase submit", p));
}

export function getMockResults(sessionId: string,
                               signal?: AbortSignal): Promise<MockResults> {
  return apiFetch(`/api/mock-exams/${enc(sessionId)}/results`, { signal })
    .then((p) => parseDto(MockResultsSchema, "GET mock results", p));
}

/** Claim the single playback of an audio material (idempotent, server clock). */
export function startMockAudio(sessionId: string, sessionUnitId: string,
                               materialId: string,
                               signal?: AbortSignal): Promise<AudioStatus> {
  return apiFetch(
    `/api/mock-exams/${enc(sessionId)}/units/${enc(sessionUnitId)}/audio/${enc(materialId)}/start`,
    { method: "POST", signal })
    .then((p) => parseDto(AudioStatusSchema, "POST mock audio start", p));
}
