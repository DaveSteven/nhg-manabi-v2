import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PracticeSession, FeedbackMode } from "../../api/dto/practice";
import type { LessonCatalog } from "../../api/dto/supplementary";
import type { JlptLevel } from "../../api/endpoints/auth";
import { ApiError } from "../../api/errors";
import { getLessons, startLesson } from "../../api/endpoints/supplementary";

export function useLessons(level: JlptLevel | null) {
  return useQuery<LessonCatalog, ApiError>({
    queryKey: ["supplementary-lessons", level],
    queryFn: ({ signal }) => getLessons(level!, signal),
    enabled: level !== null,
    staleTime: 0, // progress follows the caller's formal answers
    retry: false,
  });
}

export function useStartLesson(onStarted: (s: PracticeSession) => void) {
  const qc = useQueryClient();
  return useMutation<PracticeSession, ApiError,
                     { exam_id: string; feedback_mode: FeedbackMode }>({
    mutationFn: (input) => startLesson(input),
    onSuccess: (session) => {
      void qc.invalidateQueries({ queryKey: ["session", "current"] });
      void qc.invalidateQueries({ queryKey: ["supplementary-lessons"] });
      onStarted(session);
    },
  });
}
