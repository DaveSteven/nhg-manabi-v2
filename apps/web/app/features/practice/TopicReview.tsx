import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useQueries } from "@tanstack/react-query";
import type { FeedbackPayload, PracticeSession, ResultQuestion,
              ResultsResponse } from "../../api/dto/practice";
import { getUnitFeedback } from "../../api/endpoints/sessions";
import { toViewModel } from "../content/toViewModel";
import { useStartTopicPractice } from "../topic/useTopicPractice";
import { Button, ButtonLink } from "../../components/Button";
import { PracticeBreadcrumb } from "./PracticeBreadcrumb";
import { useSessionRestore } from "./useSessionRestore";
import { resultVerdict, summarizeResults } from "./resultsModel";
import { ReviewQuestion, VERDICT_MARK, VERDICT_TEXT } from "../review/ReviewQuestion";

/**
 * 专项练习「结果 + 答案解析」合并页（ADR-0026）：成绩概览 → 题号导航 →
 * 当前题与解析 → 底部操作。数据全部来自已完成会话的服务端接口：成绩与
 * 逐题正误来自 /results（只读历史，不重算），解析来自受门控的 per-unit
 * /feedback；切题只是本地状态，不重新请求整份结果。
 */
export function TopicReview({ sessionId, results, session }: {
  sessionId: string;
  results: ResultsResponse;
  session: PracticeSession;
}) {
  const navigate = useNavigate();
  const topic = session.config.topic!;
  const again = useStartTopicPractice((s) =>
    navigate(`/study/practice/${encodeURIComponent(s.id)}`));
  const bundle = useSessionRestore(sessionId);
  const summary = summarizeResults(results);

  // Original answering order: session unit position, then question position.
  const questions = useMemo<ResultQuestion[]>(() => [...results.questions].sort(
    (a, b) => a.unit_position - b.unit_position
      || a.question_position - b.question_position), [results.questions]);
  const firstWrong = questions.findIndex((q) => resultVerdict(q) === "wrong");
  const [activeIdx, setActiveIdx] = useState(firstWrong >= 0 ? firstWrong : 0);
  const [focus, setFocus] = useState<{ id: string; n: number } | null>(null);

  const units = bundle.data?.units ?? [];
  const contents = useMemo(() => units.map((u) => ({
    sessionUnitId: u.sessionUnitId, vm: toViewModel(u.unit),
  })), [units]);

  // Explanations for every unit (gate is open: the session is completed).
  const feedbackQs = useQueries({
    queries: contents.map((c) => ({
      queryKey: ["feedback", sessionId, c.sessionUnitId],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        getUnitFeedback(sessionId, c.sessionUnitId, signal),
      retry: 0,
      staleTime: Infinity,
    })),
  });

  const active = questions[activeIdx];
  const activeContent = active
    ? contents.find((c) => c.vm.unit.id === active.unit_id) : undefined;
  const activeFeedback: { data?: FeedbackPayload; error: Error | null } | undefined =
    activeContent
      ? feedbackQs[contents.indexOf(activeContent)] : undefined;

  const select = (i: number) => {
    setActiveIdx(i);
    const q = questions[i];
    if (q) setFocus((f) => ({ id: q.question_id, n: (f?.n ?? 0) + 1 }));
  };

  const answered = summary.correct + summary.wrong;
  const accuracy = summary.answeredAccuracyPercent ?? "—";

  return (
    <section className="container results-page review-page" aria-label="练习结果与解析">
      <PracticeBreadcrumb current="结果" examId={null} topic />
      <h1 className="sr-only">练习结果与解析</h1>

      <section className="review-summary card" aria-label="成绩概览">
        <div className="review-accuracy">
          <span className="review-accuracy-figure">{accuracy}</span>
          <span className="review-accuracy-label">正确率</span>
          <span className="text-aux review-accuracy-basis">
            {answered === 0
              ? "没有已作答的题目"
              : summary.skipped > 0
                ? `按已作答 ${answered} 题计算（未答 ${summary.skipped} 题不计入）`
                : `按全部 ${summary.total} 题计算`}
          </span>
        </div>
        <dl className="review-counts">
          <div className="is-correct"><dt>正确</dt><dd>{summary.correct}</dd></div>
          <div className="is-wrong"><dt>错误</dt><dd>{summary.wrong}</dd></div>
          <div className="is-skipped"><dt>未答</dt><dd>{summary.skipped}</dd></div>
        </dl>
      </section>

      <nav aria-label="题号导航" className="unit-nav question-strip review-strip">
        {questions.map((q, i) => {
          const v = resultVerdict(q);
          return (
            <button key={q.question_id} type="button"
                    aria-current={i === activeIdx ? "step" : undefined}
                    aria-label={`第 ${i + 1} 题（${VERDICT_TEXT[v]}）`}
                    className={`is-${v}`}
                    onClick={() => select(i)}>
              {i + 1}
              {VERDICT_MARK[v]
                ? <span aria-hidden="true" className="strip-mark">{VERDICT_MARK[v]}</span>
                : null}
            </button>
          );
        })}
      </nav>

      {bundle.isPending ? <p role="status">加载题目中…</p> : null}
      {bundle.error ? (
        <p role="alert">题目加载失败：{bundle.error.message}</p>
      ) : null}
      {active && activeContent ? (
        <ReviewQuestion
          key={activeContent.sessionUnitId}
          sessionId={sessionId}
          content={activeContent}
          active={active}
          activeIdx={activeIdx}
          total={questions.length}
          feedback={activeFeedback?.data}
          feedbackError={activeFeedback?.error ?? null}
          focus={focus}
          seqOf={(qid) => questions.findIndex((x) => x.question_id === qid) + 1}
          onActivate={(qid) => {
            const i = questions.findIndex((x) => x.question_id === qid);
            if (i >= 0) setActiveIdx(i);
          }}
          onPrev={() => select(activeIdx - 1)}
          onNext={() => select(activeIdx + 1)} />
      ) : null}

      <div className="practice-actions review-actions" role="group" aria-label="练习后操作">
        <Button variant="primary" loading={again.isPending}
                onClick={() => again.mutate({
                  level: topic.level,
                  question_type_id: topic.question_type_id,
                  count: topic.requested_count,
                  feedback_mode: session.feedback_mode,
                  selection: topic.selection,
                })}>
          {again.isPending ? "正在抽题…" : "再练一组"}
        </Button>
        <ButtonLink variant="secondary" to="/study/practice">返回专项练习</ButtonLink>
      </div>
      {again.error ? (
        <p role="alert">
          {again.error.code === "no_wrong_units"
            ? "目前没有最近仍错的题了，可返回专项练习重新选择。"
            : again.error.code === "count_exceeds_available"
            ? "仍错的题已不足原来的数量，请返回专项练习调整。"
            : `无法再练一组：${again.error.message}`}
        </p>
      ) : null}
    </section>
  );
}
