import { apiFetch } from "../client";
import { parseDto } from "../dto/exam";
import { CreateSessionResponseSchema, type FeedbackMode,
         type PracticeSession } from "../dto/practice";
import { TopicTypesSchema, type TopicSelection, type TopicTypes } from "../dto/topic";
import type { JlptLevel } from "./auth";

export function getTopicTypes(level: JlptLevel,
                              signal?: AbortSignal): Promise<TopicTypes> {
  return apiFetch(`/api/topic-practice/types?level=${encodeURIComponent(level)}`,
    { signal })
    .then((p) => parseDto(TopicTypesSchema, "GET topic-practice/types", p));
}

export interface CreateTopicSessionInput {
  level: JlptLevel;
  question_type_id: string;
  count: number;
  feedback_mode: FeedbackMode;
  /** smart (default): new-first + review; wrong_only: still-wrong Units. */
  selection?: TopicSelection;
}

/** The server samples the Units; the client only sends the configuration. */
export function createTopicSession(input: CreateTopicSessionInput,
                                   signal?: AbortSignal): Promise<PracticeSession> {
  return apiFetch("/api/topic-practice/sessions",
    { method: "POST", body: input, signal })
    .then((p) => parseDto(CreateSessionResponseSchema,
                          "POST topic-practice/sessions", p));
}
