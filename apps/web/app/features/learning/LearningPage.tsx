import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import type { RecordFilter } from "../../api/dto/learning";
import { describeLoadError } from "../../api/errors";
import { useAuth } from "../auth/authStore";
import { useLevel } from "../auth/useLevel";
import { useQuickPracticeStart } from "../practice/useStartPractice";
import { Button, ButtonLink } from "../../components/Button";
import { Pagination } from "../../components/Pagination";
import { useHistory, useOverview, useQuestionRecords } from "./useLearning";
import { LEARNING_TABS, PAGE_SIZE, RECORD_FILTERS, SUBJECT_LABEL, accuracyTone,
         formatDate, formatPercent, isLearningTab, type LearningTab } from "./learningModel";

/**
 * 我的学习 `/study/learning` (page-structure.md「我的学习」): three flat tabs.
 * Every number is derived server-side from formal submitted answers —
 * drafts never count, skip is neither right nor wrong, an unanswered
 * denominator shows “—”. Time range is all-time (range still open).
 */
export function LearningView() {
  const auth = useAuth();
  const { level } = useLevel();
  const [params, setParams] = useSearchParams();
  const requested = params.get("tab");
  const tab: LearningTab = isLearningTab(requested) ? requested : "overview";
  if (!auth.user) return <Navigate to="/login" replace />;

  return (
    <section aria-label="我的学习" className="learning-page">
      <h1>我的学习</h1>
      <div className="tabs" role="tablist" aria-label="学习内容">
        {LEARNING_TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={t.key === tab}
                  onClick={() => setParams({ tab: t.key }, { replace: true })}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === "overview" ? <OverviewTab level={level} /> : null}
      {tab === "history" ? <HistoryTab /> : null}
      {tab === "records" ? <RecordsTab level={level} /> : null}
    </section>
  );
}

function Stat({ label, value, hint, valueClass }: {
  label: string; value: string; hint?: string; valueClass?: string;
}) {
  return (
    <div className="card learning-stat">
      <span className="text-aux">{label}</span>
      <strong className={`learning-stat-value ${valueClass ?? ""}`}>{value}</strong>
      {hint ? <span className="text-aux">{hint}</span> : null}
    </div>
  );
}

function OverviewTab({ level }: { level: ReturnType<typeof useLevel>["level"] }) {
  const q = useOverview(level, true);
  if (q.isPending) return <p role="status">加载中…</p>;
  if (q.error) return <p role="alert">{describeLoadError(q.error, "学习概览")}</p>;
  const o = q.data;
  const t = o.totals;
  const ofLevel = level ? ` ${level} 的` : "";

  if (t.practiced_questions === 0 && t.skipped === 0) {
    return (
      <div className="card learning-empty">
        <p>还没有{ofLevel}作答记录，完成练习后会显示统计。</p>
        <ButtonLink variant="primary" to="/study/practice">去专项练习</ButtonLink>
      </div>
    );
  }
  return (
    <div className="learning-overview">
      {t.still_wrong_questions > 0 ? (
        <Link className="review-banner" to="/study/learning?tab=records">
          <span>
            建议先复习 · <strong>{t.still_wrong_questions}</strong> 道最近仍错
          </span>
          <span className="review-banner-go" aria-hidden="true">去复习 ›</span>
        </Link>
      ) : null}

      <div className="learning-stats">
        <Stat label="已作答正确率" value={formatPercent(t.answered_accuracy)}
              valueClass={`acc-${accuracyTone(t.answered_accuracy)}`}
              hint={`答对 ${t.correct} · 答错 ${t.wrong}（未答不计入）`} />
        <Stat label="题库覆盖率" value={formatPercent(o.coverage.ratio)}
              hint={`已练 ${o.coverage.practiced_questions} / 共 ${o.coverage.total_questions} 道不同题目`} />
        <Stat label="最近仍错" value={String(t.still_wrong_questions)}
              valueClass={t.still_wrong_questions > 0 ? "acc-bad" : undefined}
              hint="最近一次有效作答为错的题" />
        <Stat label="练习次数" value={String(t.completed_sessions)}
              hint={t.last_practiced_at
                ? `全部等级 · 最近 ${formatDate(t.last_practiced_at)}` : "全部等级"} />
      </div>

      <section className="card learning-block" aria-label="按科目">
        <h2 className="module-title">按科目</h2>
        <ul className="learning-list">
          {o.by_subject.map((s) => (
            <li key={s.subject} data-subject={s.subject}>
              <Link className="subject-row" to={`/study/practice?subject=${s.subject}`}
                    aria-label={`${SUBJECT_LABEL[s.subject]}，去专项练习`}>
                <span className="subject-chip">{SUBJECT_LABEL[s.subject]}</span>
                <span className="coverage-cell">
                  <span className="coverage-bar" aria-hidden="true">
                    <span style={{ width: `${s.total_questions
                      ? Math.max(2, (s.practiced_questions / s.total_questions) * 100) : 0}%` }} />
                  </span>
                  <span className="text-aux">
                    覆盖 {s.practiced_questions} / {s.total_questions}
                  </span>
                </span>
                <span className="subject-metric">
                  <span className="text-aux">正确率</span>
                  <span className={`acc acc-${accuracyTone(s.accuracy)}`}>
                    {formatPercent(s.accuracy)}</span>
                </span>
                <span className="subject-metric">
                  <span className="text-aux">仍错</span>
                  {s.still_wrong > 0
                    ? <span className="pill pill-danger">{s.still_wrong}</span>
                    : <span className="acc acc-none">0</span>}
                </span>
                <span className="row-chevron" aria-hidden="true">›</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="card learning-block" aria-label="薄弱题型">
        <h2 className="module-title">薄弱题型</h2>
        {o.weak_types.length === 0 ? (
          <p className="text-aux">
            暂无明显薄弱的题型。
          </p>
        ) : (
          <ul className="learning-list">
            {o.weak_types.map((w) => (
              <li key={w.question_type_id} className="learning-row" data-subject={w.subject}>
                <div>
                  <strong>{w.label_zh}</strong>
                  <span className="text-aux learning-meta">
                    <span className="subject-chip">{SUBJECT_LABEL[w.subject]}</span>
                    <span className={`acc acc-${accuracyTone(w.accuracy)}`}>
                      正确率 {formatPercent(w.accuracy)}
                    </span>
                    <span>{w.attempts} 次有效作答，答错 {w.wrong}</span>
                    {w.low_sample ? <span className="pill pill-muted">数据较少</span> : null}
                  </span>
                </div>
                <ButtonLink variant="secondary"
                            to={`/study/practice?type=${encodeURIComponent(w.question_type_id)}`}>
                  去练习
                </ButtonLink>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

const RESULT_LABEL = { wrong: "最近答错", correct: "最近答对", none: "—" } as const;
const RESULT_PILL = { wrong: "pill-danger", correct: "pill-success", none: "pill-muted" } as const;
const SOURCE_LABEL = { topic: "专项练习", quick: "快速练习", exam: "试卷练习" } as const;

/** After a page change the list is replaced; bring its top back into view. */
function scrollToTop() {
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function HistoryTab() {
  const [page, setPage] = useState(0);
  const q = useHistory(page, PAGE_SIZE, true);
  if (q.isPending) return <p role="status">加载中…</p>;
  if (q.error) return <p role="alert">{describeLoadError(q.error, "练习历史")}</p>;
  if (q.data.total === 0) {
    return (
      <div className="card learning-empty">
        <p>还没有已结束的练习记录。</p>
        <ButtonLink variant="primary" to="/study/practice">去专项练习</ButtonLink>
      </div>
    );
  }
  return (
    <>
      <ul className="learning-list card">
        {q.data.items.map((h) => {
          const body = (
            <>
              <div className="history-main">
                <strong className="learning-title">
                  <span className={`source-chip source-${h.source.kind}`}>
                    {SOURCE_LABEL[h.source.kind]}
                  </span>
                  {h.source.label ?? "练习"}
                </strong>
                <span className="text-aux">
                  {formatDate(h.happened_at)}{h.level ? ` · ${h.level}` : ""}
                  {h.state === "ended_early" ? " · 提前结束" : ""}
                </span>
              </div>
              <span className="history-score">
                <span className="text-aux">{h.total} 题</span>
                <span className={`acc acc-${accuracyTone(h.answered_accuracy)}`}>
                  {formatPercent(h.answered_accuracy)}
                </span>
              </span>
              <span className="row-chevron" aria-hidden="true">{h.has_result ? "›" : ""}</span>
            </>
          );
          return (
            <li key={h.session_id}>
              {h.has_result ? (
                <Link className="history-row is-link"
                      to={`/study/practice/${encodeURIComponent(h.session_id)}/results`}>
                  {body}
                </Link>
              ) : <div className="history-row">{body}</div>}
            </li>
          );
        })}
      </ul>
      <Pagination page={page} total={q.data.total} pageSize={PAGE_SIZE}
                  onPage={(p) => { setPage(p); scrollToTop(); }} />
    </>
  );
}

function RecordsTab({ level }: { level: ReturnType<typeof useLevel>["level"] }) {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<RecordFilter>("still_wrong");
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [filter, level]);
  const q = useQuestionRecords(filter, level, page, PAGE_SIZE, true);
  const start = useQuickPracticeStart((s) =>
    navigate(`/study/practice/${encodeURIComponent(s.id)}`));

  return (
    <>
      <div className="learning-filters" role="radiogroup" aria-label="记录筛选">
        {RECORD_FILTERS.map((f) => (
          <label key={f.key}
                 className={`learning-chip${f.key === filter ? " is-selected" : ""}`}>
            <input type="radio" name="record-filter" checked={f.key === filter}
                   onChange={() => setFilter(f.key)} />
            {f.label}
          </label>
        ))}
      </div>
      {q.isPending ? <p role="status">加载中…</p>
        : q.error ? <p role="alert">{describeLoadError(q.error, "题目记录")}</p>
        : q.data.total === 0 ? (
          <div className="card learning-empty">
            <p>{filter === "still_wrong" ? "目前没有最近仍错的题。"
              : filter === "recovered" ? "还没有从错题变为答对的题。"
              : "还没有答错过的题。"}</p>
            <Link to="/study/practice">去专项练习</Link>
          </div>
        ) : (
          <>
            <ul className="learning-list card">
              {q.data.items.map((r) => (
                <li key={r.question_id} className="learning-row" data-subject={r.subject}>
                  <div>
                    <strong>{r.exam_title}</strong>
                    <span className="text-aux">
                      {[r.layer_label, r.printed_number
                        ? `第 ${r.printed_number.replace(/^0+(?=\d)/, "")} 题` : null]
                        .filter(Boolean).join(" · ")}
                    </span>
                    <span className="learning-meta">
                      <span className="subject-chip">{r.question_type_label}</span>
                      <span className={`pill ${RESULT_PILL[r.last_result]}`}>
                        {RESULT_LABEL[r.last_result]}
                      </span>
                      <span className="text-aux">
                        作答 {r.attempt_count} 次，答错 {r.wrong_count} 次
                      </span>
                    </span>
                  </div>
                  <Button variant="secondary" disabled={start.isPending}
                          onClick={() => start.mutate({ release_id: r.release_id,
                                                        unit_id: r.unit_id })}>
                    重新练习
                  </Button>
                </li>
              ))}
            </ul>
            {start.error ? <p role="alert">无法开始练习：{start.error.message}</p> : null}
            <Pagination page={page} total={q.data.total} pageSize={PAGE_SIZE}
                        onPage={(p) => { setPage(p); scrollToTop(); }} />
          </>
        )}
    </>
  );
}
