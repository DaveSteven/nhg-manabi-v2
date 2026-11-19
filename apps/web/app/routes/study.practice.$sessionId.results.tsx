import { useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { getSessionResults } from "../api/endpoints/sessions";
import type { ResultsResponse } from "../api/dto/practice";
import type { ApiError } from "../api/errors";
import { resultVerdict, summarizeResults } from "../features/practice/resultsModel";
import { PracticeBreadcrumb, useSessionInfo } from "../features/practice/PracticeBreadcrumb";
import { ButtonLink } from "../components/Button";
import { lessonTitle } from "../features/supplementary/lessonTitle";
import { TopicReview } from "../features/practice/TopicReview";

/** Session results: completed numbers + per-question review; ended_early
 * renders an explicit early-end view with NO fabricated score. */
export default function ResultsRoute() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const info = useSessionInfo(sessionId);
  const examId = info.examId;
  const isTopic = info.topic !== null;
  const isSupp = info.supplementary !== null;
  const results = useQuery<ResultsResponse, ApiError>({
    queryKey: ["results", sessionId],
    queryFn: ({ signal }) => getSessionResults(sessionId!, signal),
    enabled: sessionId !== undefined,
    retry: 0,
    staleTime: Infinity,
  });

  if (results.isPending) return <p role="status">加载结果中…</p>;
  if (results.error !== null) {
    const e = results.error;
    if (e.status === 409 && e.code === "no_results_early_end") {
      return (
        <section className="container" aria-label="练习结果">
          <PracticeBreadcrumb current="结果" examId={examId} topic={isTopic} supplementary={isSupp} />
          <h1>练习已提前结束</h1>
          <p>本次练习有未提交的题目，因此没有生成完整成绩。已提交的答案保留在历史中。</p>
          <p>
            {isSupp
              ? <ButtonLink variant="secondary" to="/study/supplementary">返回扩展练习</ButtonLink>
              : isTopic
              ? <ButtonLink variant="secondary" to="/study/practice">返回专项练习</ButtonLink>
              : <ButtonLink variant="secondary" to="/study/exams">返回试卷列表</ButtonLink>}
          </p>
        </section>
      );
    }
    if (e.status === 409 && e.code === "session_abandoned") {
      return (
        <section className="container" aria-label="练习结果">
          <PracticeBreadcrumb current="结果" examId={examId} topic={isTopic} supplementary={isSupp} />
          <h1>这次练习已被取代</h1>
          <p>你开始了新的专项练习，这次未完成的练习没有生成成绩；已提交的答案保留在历史中。</p>
          <p>
            {isSupp
              ? <ButtonLink variant="secondary" to="/study/supplementary">返回扩展练习</ButtonLink>
              : <ButtonLink variant="secondary" to="/study/practice">返回专项练习</ButtonLink>}
          </p>
        </section>
      );
    }
    if (e.status === 409 && e.code === "session_not_finished") {
      return (
        <section className="container" aria-label="练习结果">
          <PracticeBreadcrumb current="结果" examId={examId} topic={isTopic} supplementary={isSupp} />
          <h1>练习尚未完成</h1>
          <p>完成并交卷后才能查看结果。</p>
          <p>
            <ButtonLink variant="secondary" to={`/study/practice/${encodeURIComponent(sessionId ?? "")}`}>返回练习</ButtonLink>
          </p>
        </section>
      );
    }
    return (
      <p role="alert" className="container">
        结果加载失败：{e.message}
      </p>
    );
  }

  const data = results.data!;
  let summary;
  try {
    summary = summarizeResults(data);
  } catch {
    return <p role="alert" className="container">结果数据异常（统计恒等式不成立）。</p>;
  }
  // 专项练习：结果与解析合并为一页（ADR-0026）；其他会话保持原结果页。
  if (!info.settled) return <p role="status">加载结果中…</p>;
  if (info.session !== null && info.topic !== null) {
    return <TopicReview sessionId={sessionId!} results={data} session={info.session} />;
  }

  return (
    <section className="container results-page" aria-label="练习结果">
      <PracticeBreadcrumb current="结果" examId={examId} topic={isTopic} supplementary={isSupp} />
      <h1>{info.supplementary ? lessonTitle(info.supplementary) : "练习结果"}</h1>
      <dl className="results-summary">
        <div><dt>正确</dt><dd>{summary.correct}</dd></div>
        <div><dt>错误</dt><dd>{summary.wrong}</dd></div>
        <div><dt>未答</dt><dd>{summary.skipped}</dd></div>
        <div><dt>总题数</dt><dd>{summary.total}</dd></div>
        <div><dt>得分率</dt><dd>{summary.scoreRatePercent}</dd></div>
        <div>
          <dt>已作答正确率</dt>
          <dd>{summary.answeredAccuracyPercent ?? "—"}</dd>
        </div>
      </dl>

      <h2 className="module-title">逐题复盘</h2>
      <ol className="results-review">
        {data.questions.map((q) => {
          const verdict = resultVerdict(q);
          return (
            <li key={q.question_id}
                className={`card review-row verdict-${verdict}`}>
              <span aria-hidden="true">
                {verdict === "correct" ? "✓" : verdict === "wrong" ? "✗" : "—"}
              </span>
              <span>{q.printed_number ?? q.question_id}</span>
              <span>{verdict === "skipped" ? "未答" : verdict === "correct" ? "正确" : "错误"}</span>
            </li>
          );
        })}
      </ol>
      <p>
        {isSupp
          ? <ButtonLink variant="secondary" to={`/study/supplementary?subject=${info.supplementary!.subject}`}>返回扩展练习</ButtonLink>
          : <ButtonLink variant="secondary" to="/study/exams">返回试卷列表</ButtonLink>}
      </p>
    </section>
  );
}
