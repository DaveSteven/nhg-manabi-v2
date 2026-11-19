import { apiFetch } from "../client";
import { parseDto } from "../dto/exam";
import { CreateSessionResponseSchema, type FeedbackMode,
         type PracticeSession } from "../dto/practice";
import { LessonCatalogSchema, type LessonCatalog } from "../dto/supplementary";
import type { JlptLevel } from "./auth";

export function getLessons(level: JlptLevel,
                           signal?: AbortSignal): Promise<LessonCatalog> {
  return apiFetch(`/api/supplementary/lessons?level=${encodeURIComponent(level)}`,
    { signal })
    .then((p) => parseDto(LessonCatalogSchema, "GET supplementary/lessons", p));
}

/** Starting a lesson replaces the user's in-progress practice (ADR-0016). */
export function startLesson(input: { exam_id: string; feedback_mode: FeedbackMode },
                            signal?: AbortSignal): Promise<PracticeSession> {
  return apiFetch("/api/supplementary/sessions",
    { method: "POST", body: input, signal })
    .then((p) => parseDto(CreateSessionResponseSchema,
                          "POST supplementary/sessions", p));
}
