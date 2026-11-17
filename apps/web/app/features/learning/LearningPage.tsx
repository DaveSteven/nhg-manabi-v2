import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import type { RecordFilter } from "../../api/dto/learning";
import { describeLoadError } from "../../api/errors";
import { useAuth } from "../auth/authStore";
import { useLevel } from "../auth/useLevel";
import { useQuickPracticeStart } from "../practice/useStartPractice";
import { Button, ButtonLink } from "../../components/Button";
import { useHistory, useOverview, useQuestionRecords } from "./useLearning";
import { LEARNING_TABS, PAGE_SIZE, RECORD_FILTERS, SUBJECT_LABEL, formatDate,
         formatPercent, isLearningTab, type LearningTab } from "./learningModel";

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

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card learning-stat">
      <span className="text-aux">{label}</span>
      <strong className="learning-stat-value">{value}</strong>
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
  const scope = level ? `${level} ` : "";
  const ofLevel = level ? ` ${level} 的` : "";

  if (t.practiced_questions === 0 && t.skipped === 0) {
    return (
      <div className="card learning-empty">
        <p>还没有{ofLevel}正式作答记录。完成一次练习后，这里会显示正确率、覆盖率和薄弱题型。</p>
        <ButtonLink variant="primary" to="/study/practice">去专项练习</ButtonLink>
      </div>
    );
  }
  return (
    <div className="learning-overview">
      <div className="learning-stats">
        <Stat label="已作答正确率" value={formatPercent(t.answered_accuracy)}
              hint={`答对 ${t.correct} / 答错 ${t.wrong}（未答不计入）`} />
        <Stat label={`${scope}覆盖率`} value={formatPercent(o.coverage.ratio)}
              hint={`已练 ${o.coverage.practiced_questions} / 共 ${o.coverage.total_questions} 题`} />
        <Stat label="最近仍错" value={String(t.still_wrong_questions)}
              hint="最近一次有效作答为错的题" />
        <Stat label="完成练习" value={String(t.completed_sessions)}
              hint={t.last_practiced_at
                ? `全部等级 · 最近 ${formatDate(t.last_practiced_at)}` : "全部等级"} />
      </div>

      <section className="card learning-block" aria-label="按科目">
        <h2 className="module-title">按科目</h2>
        <table className="learning-table">
          <thead>
            <tr><th scope="col">科目</th><th scope="col">覆盖</th>
                <th scope="col">正确率</th><th scope="col">仍错</th></tr>
          </thead>
          <tbody>
            {o.by_subject.map((s) => (
              <tr key={s.subject}>
                <th scope="row">{SUBJECT_LABEL[s.subject]}</th>
                <td>{s.practiced_questions} / {s.total_questions}</td>
                <td>{formatPercent(s.accuracy)}</td>
                <td>{s.still_wrong}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card learning-block" aria-label="薄弱题型">
        <h2 className="module-title">薄弱题型</h2>
        {o.weak_types.length === 0 ? (
          <p className="text-aux">
            样本还不够，暂不判断薄弱题型（同一题型有效作答达到 5 次后才会参与排名）。
          </p>
        ) : (
          <ul className="learning-list">
            {o.weak_types.map((w) => (
              <li key={w.question_type_id} className="learning-row">
                <div>
                  <strong>{w.label_zh}</strong>
                  <span className="text-aux">
                    {SUBJECT_LABEL[w.subject]} · 正确率 {formatPercent(w.accuracy)}
                    （{w.attempts} 次有效作答，答错 {w.wrong}）
                  </span>
                </div>
                <ButtonLink variant="secondary"
                            to={`/study/practice?subject=${w.subject}`}>
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

function Pager({ page, total, onPage }: {
  page: number; total: number; onPage: (p: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (pages <= 1) return null;
  return (
    <div className="learning-pager">
      <Button variant="secondary" disabled={page === 0}
              onClick={() => onPage(page - 1)}>上一页</Button>
      <span className="text-aux">第 {page + 1} / {pages} 页</span>
      <Button variant="secondary" disabled={page + 1 >= pages}
              onClick={() => onPage(page + 1)}>下一页</Button>
    </div>
  );
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
        {q.data.items.map((h) => (
          <li key={h.session_id} className="learning-row">
            <div>
              <strong>
                {h.source.kind === "topic" ? "专项 · " : h.source.kind === "quick" ? "快速 · " : ""}
                {h.source.label ?? "练习"}
              </strong>
              <span className="text-aux">
                {formatDate(h.happened_at)}{h.level ? ` · ${h.level}` : ""}
                {h.state === "ended_early" ? " · 提前结束" : ""}
              </span>
              <span className="text-aux">
                答对 {h.correct} · 答错 {h.wrong} · 未答 {h.skipped}
                （已作答正确率 {formatPercent(h.answered_accuracy)}）
              </span>
            </div>
            {h.has_result ? (
              <ButtonLink variant="secondary"
                          to={`/study/practice/${encodeURIComponent(h.session_id)}/results`}>
                查看结果
              </ButtonLink>
            ) : null}
          </li>
        ))}
      </ul>
      <Pager page={page} total={q.data.total} onPage={setPage} />
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
                <li key={r.question_id} className="learning-row">
                  <div>
                    <strong>{r.exam_title}</strong>
                    <span className="text-aux">
                      {[r.layer_label, r.printed_number
                        ? `第 ${r.printed_number.replace(/^0+(?=\d)/, "")} 题` : null]
                        .filter(Boolean).join(" · ")}
                      {" · "}{r.question_type_label}
                    </span>
                    <span className="text-aux">
                      {RESULT_LABEL[r.last_result]} · 作答 {r.attempt_count} 次，答错 {r.wrong_count} 次
                    </span>
                  </div>
                  <Button variant="secondary" disabled={start.isPending}
                          onClick={() => start.mutate({ release_id: r.release_id,
                                                        unit_id: r.unit_id })}>
                    再练这一组
                  </Button>
                </li>
              ))}
            </ul>
            {start.error ? <p role="alert">无法开始练习：{start.error.message}</p> : null}
            <Pager page={page} total={q.data.total} onPage={setPage} />
          </>
        )}
    </>
  );
}
