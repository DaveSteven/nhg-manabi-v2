import { Navigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import type { MockResults as Results } from "../../api/dto/mock";
import { ApiError, describeLoadError } from "../../api/errors";
import { getMockResults } from "../../api/endpoints/mock";
import { ButtonLink } from "../../components/Button";
import { useAuth } from "../auth/authStore";
import { formatPercent } from "../learning/learningModel";

const SUBJECT: Record<string, string> = {
  vocabulary: "文字词汇", grammar: "文法", reading: "读解", listening: "听力",
};

/** Minimal mock result (per phase / subject): counts + answered accuracy.
 * No converted score and no pass/fail (ADR-0019 M7). Per-question review
 * is a later step. */
export function MockResultsPage({ sessionId }: { sessionId: string }) {
  const auth = useAuth();
  const q = useQuery<Results, ApiError>({
    queryKey: ["mock", "results", sessionId],
    queryFn: ({ signal }) => getMockResults(sessionId, signal),
    retry: 0,
  });
  if (!auth.user) return <Navigate to="/login" replace />;
  if (q.isPending) return <p role="status">加载中…</p>;
  if (q.error) return <p role="alert">{describeLoadError(q.error, "模拟考试成绩")}</p>;
  const r = q.data;
  const row = (label: string, t: { correct: number; wrong: number; skipped: number;
                                   answered_accuracy: number | null }, key: string) => (
    <tr key={key}>
      <th scope="row">{label}</th>
      <td>{t.correct}</td><td>{t.wrong}</td><td>{t.skipped}</td>
      <td>{formatPercent(t.answered_accuracy)}</td>
    </tr>
  );
  const head = (first: string) => (
    <thead><tr><th scope="col">{first}</th><th scope="col">答对</th>
      <th scope="col">答错</th><th scope="col">未答</th>
      <th scope="col">已作答正确率</th></tr></thead>
  );
  return (
    <section aria-label="模拟考试成绩" className="mock-intro">
      <h1>模拟考试成绩</h1>
      <div className="card learning-block">
        <p>
          共 {r.total_count} 题：答对 <strong>{r.correct_count}</strong>，
          答错 <strong>{r.wrong_count}</strong>，未答 <strong>{r.skipped_count}</strong>
          ；已作答正确率 <strong>{formatPercent(r.answered_accuracy)}</strong>
        </p>
      </div>
      <div className="card learning-block">
        <h2 className="module-title">各阶段</h2>
        <table className="mock-phase-table">{head("阶段")}
          <tbody>{r.phases.map((p) => row(p.title, p, p.phase_id))}</tbody></table>
      </div>
      <div className="card learning-block">
        <h2 className="module-title">各科目</h2>
        <table className="mock-phase-table">{head("科目")}
          <tbody>{r.subjects.map((s) => row(SUBJECT[s.subject] ?? s.subject, s, s.subject))}</tbody></table>
      </div>
      <div className="mock-actions">
        <ButtonLink variant="primary" to="/study/exams">返回试卷</ButtonLink>
      </div>
    </section>
  );
}
