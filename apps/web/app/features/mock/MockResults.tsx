import { useMemo, useState } from "react";
import { Navigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import type { MockResultQuestion, MockResults as Results } from "../../api/dto/mock";
import type { FeedbackPayload } from "../../api/dto/practice";
import { ApiError, describeLoadError } from "../../api/errors";
import { getReleaseUnit } from "../../api/endpoints/exams";
import { getMockResults, getMockUnitFeedback } from "../../api/endpoints/mock";
import { Breadcrumb } from "../../components/Breadcrumb";
import { ButtonLink } from "../../components/Button";
import { useAuth } from "../auth/authStore";
import { formatDate, formatPercent, SUBJECT_LABEL } from "../learning/learningModel";
import { toViewModel } from "../content/toViewModel";
import { resultVerdict } from "../practice/resultsModel";
import { ReviewQuestion, VERDICT_MARK, VERDICT_TEXT,
         type Verdict } from "../review/ReviewQuestion";

type Filter = "all" | "wrong" | "skipped";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "全部" }, { key: "wrong", label: "错误" },
  { key: "skipped", label: "未答" },
];
const SUBJECT_ORDER = ["vocabulary", "grammar", "reading", "listening"] as const;

export function formatDuration(seconds: number): string {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} 分钟`;
  return `${Math.floor(m / 60)} 小时 ${m % 60} 分钟`;
}

/**
 * 模考成绩页（成绩概览 → 科目表现 → 逐题回顾 → 底部操作）。
 * 只展示原始作答统计：JLPT 官方成绩为换算分，本站没有可靠换算模型，
 * 不给换算分，也不做合格判定（ADR-0019 M7）。回顾复用专项练习的
 * ReviewQuestion；历史结果只读。
 */
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
  return <ResultsView sessionId={sessionId} r={q.data} />;
}

function ResultsView({ sessionId, r }: { sessionId: string; r: Results }) {
  const answered = r.correct_count + r.wrong_count;
  return (
    <section className="container results-page review-page" aria-label="模拟考试成绩">
      <Breadcrumb items={[{ label: "试卷", to: "/study/exams" },
                          { label: r.exam_title,
                            to: `/study/exams/${encodeURIComponent(r.exam_id)}` },
                          { label: "模拟考试成绩" }]} />
      <h1 className="sr-only">模拟考试成绩</h1>

      <section className="review-summary card" aria-label="成绩概览">
        <div className="review-accuracy">
          <span className="review-accuracy-figure">{formatPercent(r.answered_accuracy)}</span>
          <span className="review-accuracy-label">正确率</span>
          <span className="text-aux review-accuracy-basis">
            {r.exam_title} · {r.level} · {formatDate(r.finished_at)} · 用时 {formatDuration(r.duration_seconds)}
          </span>
          <span className="text-aux review-accuracy-basis">
            {answered === 0
              ? "没有已作答的题目"
              : r.skipped_count > 0
                ? `按已作答 ${answered} 题计算（未答 ${r.skipped_count} 题不计入）`
                : `按全部 ${r.total_count} 题计算`}
            。这是原始正确率，不等同于 JLPT 官方换算成绩，不作合格判定。
          </span>
        </div>
        <dl className="review-counts">
          <div className="is-correct"><dt>答对</dt><dd>{r.correct_count}</dd></div>
          <div className="is-wrong"><dt>答错</dt><dd>{r.wrong_count}</dd></div>
          <div className="is-skipped"><dt>未答</dt><dd>{r.skipped_count}</dd></div>
        </dl>
      </section>

      <section className="card learning-block" aria-label="科目表现">
        <h2 className="module-title">科目表现</h2>
        <table className="mock-phase-table">
          <thead><tr><th scope="col">科目</th><th scope="col">答对</th>
            <th scope="col">答错</th><th scope="col">未答</th>
            <th scope="col">正确率</th></tr></thead>
          <tbody>
            {r.subjects.map((s) => (
              <tr key={s.subject}>
                <th scope="row">
                  {SUBJECT_LABEL[s.subject as keyof typeof SUBJECT_LABEL] ?? s.subject}
                </th>
                <td>{s.correct}</td><td>{s.wrong}</td><td>{s.skipped}</td>
                <td>{formatPercent(s.answered_accuracy)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <MockReview sessionId={sessionId} results={r} />

      <div className="practice-actions review-actions" role="group" aria-label="成绩页操作">
        <ButtonLink variant="primary"
                    to={`/study/exams/${encodeURIComponent(r.exam_id)}`}>
          返回试卷
        </ButtonLink>
        <ButtonLink variant="secondary" to="/study/learning?tab=history">
          练习历史
        </ButtonLink>
      </div>
    </section>
  );
}

function MockReview({ sessionId, results }: { sessionId: string; results: Results }) {
  // Answering order, and the fixed 1..N numbering shown on every filter.
  const all = useMemo<MockResultQuestion[]>(() => [...results.questions].sort(
    (a, b) => a.unit_position - b.unit_position
      || a.question_position - b.question_position), [results.questions]);
  const verdictOf = (x: MockResultQuestion): Verdict => resultVerdict(x);
  const firstWrong = all.find((x) => verdictOf(x) === "wrong");

  const [filter, setFilter] = useState<Filter>("all");
  const [activeId, setActiveId] = useState<string | null>(
    (firstWrong ?? all[0])?.question_id ?? null);
  const [focus, setFocus] = useState<{ id: string; n: number } | null>(null);

  const matches = (x: MockResultQuestion, f: Filter) =>
    f === "all" || (f === "wrong" ? verdictOf(x) === "wrong"
                                  : verdictOf(x) === "skipped");
  const shown = all.filter((x) => matches(x, filter));
  const active = all.find((x) => x.question_id === activeId) ?? null;
  const pos = shown.findIndex((x) => x.question_id === activeId);

  const select = (id: string) => {
    setActiveId(id);
    setFocus((f) => ({ id, n: (f?.n ?? 0) + 1 }));
  };
  const changeFilter = (f: Filter) => {
    setFilter(f);
    const next = all.filter((x) => matches(x, f));
    const first = next[0];
    if (first && !next.some((x) => x.question_id === activeId)) select(first.question_id);
  };

  const groups = SUBJECT_ORDER
    .map((subject) => ({
      subject,
      items: all.map((x, i) => ({ x, no: i + 1 }))
        .filter(({ x }) => x.subject === subject && matches(x, filter)),
    }))
    .filter((g) => g.items.length > 0);
  const countOf = (f: Filter) => all.filter((x) => matches(x, f)).length;

  return (
    <section aria-label="逐题回顾" className="mock-review">
      <h2 className="module-title">逐题回顾</h2>
      <div className="learning-filters" role="radiogroup" aria-label="回顾筛选">
        {FILTERS.map((f) => (
          <label key={f.key}
                 className={`learning-chip${f.key === filter ? " is-selected" : ""}`}>
            <input type="radio" name="mock-review-filter" checked={f.key === filter}
                   onChange={() => changeFilter(f.key)} />
            {f.label} {countOf(f.key)}
          </label>
        ))}
      </div>

      {groups.length === 0 ? (
        <p className="card learning-empty text-aux">
          {filter === "wrong" ? "没有答错的题，做得很好。" : "没有未答的题。"}
        </p>
      ) : (
        <nav aria-label="题号导航" className="mock-review-nav">
          {groups.map((g) => (
            <div key={g.subject} className="mock-review-group" role="group"
                 aria-label={SUBJECT_LABEL[g.subject]}>
              <span className="mock-review-group-title">{SUBJECT_LABEL[g.subject]}</span>
              <div className="unit-nav question-strip review-strip">
                {g.items.map(({ x, no }) => {
                  const v = verdictOf(x);
                  return (
                    <button key={x.question_id} type="button"
                            aria-current={x.question_id === activeId ? "step" : undefined}
                            aria-label={`第 ${no} 题（${VERDICT_TEXT[v]}）`}
                            className={`is-${v}`}
                            onClick={() => select(x.question_id)}>
                      {no}
                      {VERDICT_MARK[v]
                        ? <span aria-hidden="true" className="strip-mark">{VERDICT_MARK[v]}</span>
                        : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      )}

      {active && shown.length > 0 ? (
        <ReviewUnit key={active.session_unit_id}
          sessionId={sessionId} releaseId={results.release_id}
          active={active} all={all}
          pagerIndex={pos} pagerTotal={shown.length}
          focus={focus} onActivate={setActiveId}
          onPrev={() => { const t = shown[pos - 1]; if (t) select(t.question_id); }}
          onNext={() => { const t = shown[Math.min(pos + 1, shown.length - 1)]; if (t) select(t.question_id); }} />
      ) : null}
    </section>
  );
}

function ReviewUnit({ sessionId, releaseId, active, all, pagerIndex, pagerTotal,
  focus, onActivate, onPrev, onNext }: {
  sessionId: string;
  releaseId: string;
  active: MockResultQuestion;
  all: MockResultQuestion[];
  pagerIndex: number;
  pagerTotal: number;
  focus: { id: string; n: number } | null;
  onActivate: (questionId: string) => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  // Content is the public (answer-free) release payload; answers and
  // explanations come from the completed-mock-only feedback endpoint.
  const unit = useQuery({
    queryKey: ["mock", "review-unit", releaseId, active.unit_id],
    queryFn: ({ signal }) => getReleaseUnit(releaseId, active.unit_id, signal),
    retry: 0, staleTime: Infinity,
  });
  const feedback = useQuery<FeedbackPayload, ApiError>({
    queryKey: ["mock", "review-feedback", sessionId, active.session_unit_id],
    queryFn: ({ signal }) => getMockUnitFeedback(sessionId, active.session_unit_id, signal),
    retry: 0, staleTime: Infinity,
  });
  const content = useMemo(() => unit.data
    ? { sessionUnitId: active.session_unit_id, vm: toViewModel(unit.data) } : null,
    [unit.data, active.session_unit_id]);

  if (unit.error) return <p role="alert">题目加载失败：{unit.error.message}</p>;
  if (!content) return <p role="status">加载题目中…</p>;
  return (
    <ReviewQuestion
      sessionId={sessionId} content={content} active={active}
      activeIdx={Math.max(pagerIndex, 0)} total={pagerTotal}
      feedback={feedback.data} feedbackError={feedback.error}
      focus={focus} transcriptSource="mock"
      seqOf={(qid) => all.findIndex((x) => x.question_id === qid) + 1}
      onActivate={onActivate} onPrev={onPrev} onNext={onNext} />
  );
}
