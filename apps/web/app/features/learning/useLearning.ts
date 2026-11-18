import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { Streak, History, HistoryKind, Overview, QuestionRecords,
              RecordFilter } from "../../api/dto/learning";
import type { JlptLevel } from "../../api/endpoints/auth";
import { ApiError } from "../../api/errors";
import { getStreak, getHistory, getOverview,
         getQuestionRecords } from "../../api/endpoints/learning";

// Always re-read: every formal submit changes these numbers.
const live = { staleTime: 0, retry: false } as const;

export function useOverview(level: JlptLevel | null, enabled: boolean) {
  return useQuery<Overview, ApiError>({
    queryKey: ["learning", "overview", level],
    queryFn: ({ signal }) => getOverview(level, signal),
    enabled, ...live,
  });
}

export function useHistory(kind: HistoryKind, page: number, size: number,
                           enabled: boolean) {
  return useQuery<History, ApiError>({
    queryKey: ["learning", "history", kind, page, size],
    queryFn: ({ signal }) => getHistory(kind, size, page * size, signal),
    placeholderData: keepPreviousData, enabled, ...live,
  });
}

export function useQuestionRecords(filter: RecordFilter, level: JlptLevel | null,
                                   page: number, size: number, enabled: boolean) {
  return useQuery<QuestionRecords, ApiError>({
    queryKey: ["learning", "questions", filter, level, page, size],
    queryFn: ({ signal }) => getQuestionRecords(filter, level, size, page * size, signal),
    placeholderData: keepPreviousData, enabled, ...live,
  });
}

export function useStreak(enabled: boolean) {
  return useQuery<Streak, ApiError>({
    queryKey: ["learning", "streak"],
    queryFn: ({ signal }) => getStreak(signal),
    enabled, ...live,
  });
}
