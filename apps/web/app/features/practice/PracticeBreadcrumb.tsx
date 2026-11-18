import { useQuery } from "@tanstack/react-query";
import { Breadcrumb } from "../../components/Breadcrumb";
import { getSession } from "../../api/endpoints/sessions";
import { useNavSection } from "../../components/TopNav";
import { examRoute } from "../catalog/viewModels";

/**
 * Trail for the practice and results pages: 试卷 › 详情 › 练习|结果. The 详情
 * crumb links to the exam the session belongs to (from the session units'
 * exam_id); when that isn't known (still loading, or the session can't be
 * read) the crumb is omitted rather than pointing somewhere wrong.
 */
export function PracticeBreadcrumb({ current, examId, topic = false }: {
  current: string;
  examId: string | null;
  /** 专项练习 sessions draw Units from many exams: trail is 专项练习 ›
   * 练习|结果 and never points at one exam. */
  topic?: boolean;
}) {
  useNavSection(topic ? "topic" : "exams");
  if (topic) {
    return (
      <Breadcrumb items={[{ label: "专项练习", to: "/study/practice" },
                          { label: current }]} />
    );
  }
  return (
    <Breadcrumb items={[
      { label: "试卷", to: "/study/exams" },
      ...(examId ? [{ label: "详情", to: examRoute(examId) }] : []),
      { label: current },
    ]} />
  );
}

/** exam_id of the session's first unit, via the session endpoint. */
export function useSessionExamId(sessionId: string | undefined): string | null {
  return useSessionInfo(sessionId).examId;
}

export function useSessionInfo(sessionId: string | undefined) {
  const q = useQuery({
    queryKey: ["session-exam", sessionId],
    queryFn: ({ signal }) => getSession(sessionId!, signal),
    enabled: sessionId !== undefined,
    retry: 0,
    staleTime: Infinity,
  });
  return {
    session: q.data ?? null,
    /** The session query has settled (success or failure). */
    settled: !q.isPending,
    examId: q.data?.units[0]?.exam_id ?? null,
    topic: q.data?.config.topic ?? null,
    feedbackMode: q.data?.feedback_mode ?? null,
  };
}
