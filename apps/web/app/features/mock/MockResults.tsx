import { useMemo, useRef, useState } from "react";
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

type Filter = "all" | "wrong" | "correct" | "skipped";
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
          <span className="review-accuracy-label">已作答正确率</span>
          <span className="text-aux review-accuracy-basis">
            {r.exam_title} · {r.level} · {formatDate(r.finished_at)} · 用时 {formatDuration(r.duration_seconds)}
          </span>
          <span className="text-aux review-accuracy-basis">
            已答 {answered} / {r.total_count} 题；未答题不计入正确率，也不算错。
            原始统计，不等同于 JLPT 官方换算成绩，不作合格判定。
          </span>
        </div>
        <dl className="review-counts">
          <div className="is-correct"><dt>答对</dt><dd>{r.correct_count}</dd></div>
          <div className="is-wrong"><dt>答错</dt><dd>{r.wrong_count}</dd></div>
          <div className="is-skipped"><dt>未答</dt><dd>{r.skipped_count}</dd></div>
        </dl>
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

type Subject = (typeof SUBJECT_ORDER)[number];
interface ReviewState { subject: Subject; filter: Filter; activeId: string | null }

const FILTERS: { key: Filter; label: string }[] = [
  { key: "wrong", label: "错误" }, { key: "all", label: "全部" },
  { key: "correct", label: "正确" }, { key: "skipped", label: "未答" },
];

function MockReview({ sessionId, results }: { sessionId: string; results: Results }) {
  // Answering order; the 1..N numbers never change with subject or filter.
  const all = useMemo<MockResultQuestion[]>(() => [...results.questions].sort(
    (a, b) => a.unit_position - b.unit_position
      || a.question_position - b.question_position), [results.questions]);
  const verdictOf = (x: MockResultQuestion): Verdict => resultVerdict(x);
  const noOf = (x: MockResultQuestion) => all.indexOf(x) + 1;
  const matches = (x: MockResultQuestion, f: Filter) =>
    f === "all" || verdictOf(x) === f;
  const inScope = (subject: Subject, f: Filter) =>
    all.filter((x) => x.subject === subject && matches(x, f));

  const subjects = SUBJECT_ORDER.filter((s) => all.some((x) => x.subject === s));
  const storeKey = `minao-mock-review:${sessionId}`;

  const initial = (): ReviewState => {
    try {
      const saved = JSON.parse(window.sessionStorage.getItem(storeKey) ?? "null");
      const q = all.find((x) => x.question_id === saved?.activeId);
      if (q && subjects.includes(saved.subject)
          && FILTERS.some((f) => f.key === saved.filter)) return saved;
    } catch { /* ignore a corrupt saved state */ }
    const firstWrong = all.find((x) => verdictOf(x) === "wrong");
    const subject = (firstWrong?.subject ?? subjects[0] ?? "vocabulary") as Subject;
    const filter: Filter = inScope(subject, "wrong").length > 0 ? "wrong" : "all";
    return { subject, filter, activeId: (inScope(subject, filter)[0])?.question_id ?? null };
  };
  const [st, setSt] = useState<ReviewState>(initial);
  const [focus, setFocus] = useState<{ id: string; n: number } | null>(null);
  const areaRef = useRef<HTMLDivElement>(null);

  const apply = (next: ReviewState, scroll = true) => {
    setSt(next);
    try { window.sessionStorage.setItem(storeKey, JSON.stringify(next)); }
    catch { /* storage unavailable: state just isn't remembered */ }
    if (next.activeId) setFocus((f) => ({ id: next.activeId!, n: (f?.n ?? 0) + 1 }));
    if (scroll) areaRef.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  };
  const defaultFilter = (subject: Subject): Filter =>
    inScope(subject, "wrong").length > 0 ? "wrong" : "all";
  const chooseSubject = (subject: Subject) => {
    const filter = defaultFilter(subject);
    apply({ subject, filter, activeId: inScope(subject, filter)[0]?.question_id ?? null });
  };
  const chooseFilter = (filter: Filter) =>
    apply({ ...st, filter, activeId: inScope(st.subject, filter)[0]?.question_id ?? null });
  const select = (id: string) => apply({ ...st, activeId: id });

  const shown = inScope(st.subject, st.filter);
  const active = shown.find((x) => x.question_id === st.activeId) ?? null;
  const pos = active ? shown.indexOf(active) : -1;
  const stat = (subject: Subject) => {
    const qs = all.filter((x) => x.subject === subject);
    const c = qs.filter((x) => verdictOf(x) === "correct").length;
    const w = qs.filter((x) => verdictOf(x) === "wrong").length;
    return { total: qs.length, answered: c + w, wrong: w,
             accuracy: c + w > 0 ? c / (c + w) : null };
  };

  return (
    <section aria-label="逐题回顾" className="mock-review">
      <div className="mock-subjects" role="tablist" aria-label="科目">
        {subjects.map((subject) => {
          const t = stat(subject);
          return (
            <button key={subject} type="button" role="tab"
                    aria-selected={subject === st.subject}
                    className="mock-subject-card"
                    onClick={() => chooseSubject(subject)}>
              <strong>{SUBJECT_LABEL[subject]}</strong>
              <span className="text-aux">
                已答 {t.answered}/{t.total} · 答错 {t.wrong} · 正确率 {formatPercent(t.accuracy)}
              </span>
            </button>
          );
        })}
      </div>

      <div className="learning-filters" role="radiogroup" aria-label="回顾筛选">
        {FILTERS.map((f) => (
          <label key={f.key}
                 className={`learning-chip${f.key === st.filter ? " is-selected" : ""}`}>
            <input type="radio" name="mock-review-filter" checked={f.key === st.filter}
                   onChange={() => chooseFilter(f.key)} />
            {f.label} {inScope(st.subject, f.key).length}
          </label>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="card learning-empty text-aux">这个范围内没有题目。</p>
      ) : (
        <nav aria-label="题号导航" className="unit-nav question-strip review-strip">
          {shown.map((x) => {
            const v = verdictOf(x);
            return (
              <button key={x.question_id} type="button"
                      aria-current={x.question_id === st.activeId ? "step" : undefined}
                      aria-label={`第 ${noOf(x)} 题（${VERDICT_TEXT[v]}）`}
                      className={`is-${v}`}
                      onClick={() => select(x.question_id)}>
                {noOf(x)}
                {VERDICT_MARK[v]
                  ? <span aria-hidden="true" className="strip-mark">{VERDICT_MARK[v]}</span>
                  : null}
              </button>
            );
          })}
        </nav>
      )}

      <div ref={areaRef} className="mock-review-area">
        {active ? (
          <ReviewUnit key={active.session_unit_id}
            sessionId={sessionId} releaseId={results.release_id}
            active={active} all={all}
            pagerIndex={pos} pagerTotal={shown.length}
            focus={focus}
            onActivate={(id) => {
              // clicking a slot inside a shared material moves within the unit
              if (shown.some((x) => x.question_id === id)) {
                setSt((cur) => ({ ...cur, activeId: id }));
              }
            }}
            onPrev={() => { const t = shown[pos - 1]; if (t) select(t.question_id); }}
            onNext={() => { const t = shown[pos + 1]; if (t) select(t.question_id); }} />
        ) : null}
      </div>
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
