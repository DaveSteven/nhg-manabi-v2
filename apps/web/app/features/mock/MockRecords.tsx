import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import type { ExamMockResults } from "../../api/dto/mock";
import { ApiError } from "../../api/errors";
import { getExamMockResults } from "../../api/endpoints/mock";
import { useAuth } from "../auth/authStore";
import { accuracyTone, formatDate, formatPercent } from "../learning/learningModel";

/**
 * 试卷详情「历次模拟考试记录」：只列当前用户对这份试卷已完成的模考，
 * 每次独立保存，点击进入统一的模考成绩页（同一历史记录 ID）。未登录、
 * 无记录或加载失败时不占位（不影响试卷练习入口）。
 */
export function MockRecords({ examId }: { examId: string }) {
  const auth = useAuth();
  const q = useQuery<ExamMockResults, ApiError>({
    queryKey: ["mock", "exam-records", examId],
    queryFn: ({ signal }) => getExamMockResults(examId, signal),
    enabled: !!auth.user, retry: 0, staleTime: 0,
  });
  if (!auth.user || !q.data || q.data.items.length === 0) return null;
  return (
    <section className="mock-records" aria-label="历次模拟考试记录">
      <h2 className="module-title">历次模拟考试记录</h2>
      <ul className="learning-list card">
        {q.data.items.map((m) => (
          <li key={m.session_id}>
            <Link className="history-row is-link"
                  to={`/study/mock/${encodeURIComponent(m.session_id)}/results`}>
              <div className="history-main">
                <strong className="learning-title">{formatDate(m.finished_at)}</strong>
                <span className="text-aux">
                  答对 {m.correct} · 答错 {m.wrong} · 未答 {m.skipped}
                </span>
              </div>
              <span className="history-score">
                <span className="text-aux">{m.total} 题</span>
                <span className={`acc acc-${accuracyTone(m.answered_accuracy)}`}>
                  {formatPercent(m.answered_accuracy)}
                </span>
              </span>
              <span className="row-chevron" aria-hidden="true">›</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
