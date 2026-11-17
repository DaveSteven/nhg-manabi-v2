import { apiFetch } from "../client";
import { parseDto } from "../dto/exam";
import { HistorySchema, OverviewSchema, QuestionRecordsSchema,
         type History, type Overview, type QuestionRecords,
         type RecordFilter } from "../dto/learning";
import type { JlptLevel } from "./auth";

export function getOverview(level: JlptLevel | null,
                            signal?: AbortSignal): Promise<Overview> {
  const q = level ? `?level=${encodeURIComponent(level)}` : "";
  return apiFetch(`/api/me/learning/overview${q}`, { signal })
    .then((p) => parseDto(OverviewSchema, "GET me/learning/overview", p));
}

export function getHistory(limit: number, offset: number,
                           signal?: AbortSignal): Promise<History> {
  return apiFetch(`/api/me/learning/history?limit=${limit}&offset=${offset}`,
    { signal })
    .then((p) => parseDto(HistorySchema, "GET me/learning/history", p));
}

export function getQuestionRecords(
  filter: RecordFilter, level: JlptLevel | null, limit: number, offset: number,
  signal?: AbortSignal,
): Promise<QuestionRecords> {
  const params = new URLSearchParams({ filter, limit: String(limit),
                                       offset: String(offset) });
  if (level) params.set("level", level);
  return apiFetch(`/api/me/learning/questions?${params}`, { signal })
    .then((p) => parseDto(QuestionRecordsSchema, "GET me/learning/questions", p));
}
