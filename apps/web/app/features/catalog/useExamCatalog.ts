import { useQuery } from "@tanstack/react-query";
import type { PracticeSession } from "../../api/dto/practice";
import type { ExamOutline, ExamSummary } from "../../api/dto/exam";
import { ApiError } from "../../api/errors";
import { getExamOutline, getExams } from "../../api/endpoints/exams";
import { getCurrentSession } from "../../api/endpoints/sessions";

export const CATALOG_STALE_TIME = 5 * 60 * 1000;

export function useExamList() {
  return useQuery<ExamSummary[], ApiError>({
    queryKey: ["exams"],
    queryFn: ({ signal }) => getExams(signal),
    staleTime: CATALOG_STALE_TIME,
  });
}

export function useExamOutline(examId: string | undefined) {
  return useQuery<ExamOutline, ApiError>({
    queryKey: ["exam", examId],
    queryFn: ({ signal }) => getExamOutline(examId!, signal),
    enabled: examId !== undefined,
    staleTime: CATALOG_STALE_TIME,
  });
}

/**
 * GET /api/practice/sessions/current discriminated states. A 404 with
 * "no active practice" is the normal idle state — never an error banner;
 * 401 is its own state (login flow comes later); other failures are
 * errors.
 */
export type CurrentSessionState =
  | { kind: "loading" }
  | { kind: "error"; error: ApiError }
  | { kind: "unauthenticated" }
  | { kind: "no-active" }
  | { kind: "active"; session: PracticeSession };

export function useCurrentSession(): CurrentSessionState {
  const query = useQuery<PracticeSession, ApiError>({
    queryKey: ["session", "current"],
    queryFn: ({ signal }) => getCurrentSession(signal),
    retry: false,
    staleTime: 0,
  });

  if (query.isPending) return { kind: "loading" };
  if (query.error !== null) {
    const error = query.error;
    if (error.status === 401) return { kind: "unauthenticated" };
    if (error.status === 404) return { kind: "no-active" };
    return { kind: "error", error };
  }
  return { kind: "active", session: query.data! };
}
