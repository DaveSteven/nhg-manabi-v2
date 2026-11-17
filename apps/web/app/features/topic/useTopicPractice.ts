import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PracticeSession } from "../../api/dto/practice";
import type { TopicTypes } from "../../api/dto/topic";
import type { JlptLevel } from "../../api/endpoints/auth";
import { ApiError } from "../../api/errors";
import { createTopicSession, getTopicTypes,
         type CreateTopicSessionInput } from "../../api/endpoints/topic";

export function useTopicTypes(level: JlptLevel | null) {
  return useQuery<TopicTypes, ApiError>({
    queryKey: ["topic-types", level],
    queryFn: ({ signal }) => getTopicTypes(level!, signal),
    enabled: level !== null,
    staleTime: 0, // "new units" follows the caller's formal history
    retry: false,
  });
}

export function useStartTopicPractice(
  onStarted: (session: PracticeSession) => void,
) {
  const qc = useQueryClient();
  return useMutation<PracticeSession, ApiError, CreateTopicSessionInput>({
    mutationFn: (input) => createTopicSession(input),
    onSuccess: (session) => {
      void qc.invalidateQueries({ queryKey: ["session", "current"] });
      void qc.invalidateQueries({ queryKey: ["topic-types"] });
      onStarted(session);
    },
  });
}
