import { useQuery } from "@tanstack/react-query";
import { Breadcrumb } from "../../components/Breadcrumb";
import { getSession } from "../../api/endpoints/sessions";
import { examRoute } from "../catalog/viewModels";

/**
 * Trail for the practice and results pages: 试卷 › 详情 › 练习|结果. The 详情
 * crumb links to the exam the session belongs to (from the session units'
 * exam_id); when that isn't known (still loading, or the session can't be
 * read) the crumb is omitted rather than pointing somewhere wrong.
 */
export function PracticeBreadcrumb({ current, examId }: {
  current: string;
  examId: string | null;
}) {
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
  const q = useQuery({
    queryKey: ["session-exam", sessionId],
    queryFn: ({ signal }) => getSession(sessionId!, signal),
    enabled: sessionId !== undefined,
    retry: 0,
    staleTime: Infinity,
  });
  return q.data?.units[0]?.exam_id ?? null;
}
