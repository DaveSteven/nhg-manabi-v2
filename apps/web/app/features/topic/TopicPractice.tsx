import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import type { TopicType } from "../../api/dto/topic";
import { describeLoadError } from "../../api/errors";
import type { FeedbackMode } from "../../api/dto/practice";
import { useLevel } from "../auth/useLevel";
import { useStartTopicPractice, useTopicTypes } from "./useTopicPractice";
import { COUNT_PRESETS, TOPIC_SUBJECTS, checkCount, defaultCount, isTopicSubject,
         maxCount, unitNoun, type TopicSubject } from "./topicModel";

/**
 * 专项练习 `/study/practice` (page-structure.md): level (follows the header
 * selector) → ONE question type → Unit count → feedback mode → start. The
 * server draws the Units (smart random: new-first, ~25% review); the page
 * never sends or sees unit ids. Counts shown are real practicable Units.
 */
export function TopicPracticeView() {
  const navigate = useNavigate();
  const { level } = useLevel();
  const [params, setParams] = useSearchParams();
  const query = useTopicTypes(level);
  const types = query.data?.types ?? [];

  const requested = params.get("subject");
  const subject: TopicSubject = isTopicSubject(requested)
    ? requested
    : (TOPIC_SUBJECTS.find((s) => types.some((t) => t.subject === s.key))?.key
       ?? "vocabulary");
  const subjectTypes = useMemo(
    () => types.filter((t) => t.subject === subject), [types, subject]);

  const [typeId, setTypeId] = useState<string | null>(null);
  const [countText, setCountText] = useState("10");
  const [feedback, setFeedback] = useState<FeedbackMode>("immediate");

  // keep the selection valid when the subject/level/catalog changes
  useEffect(() => {
    if (typeId !== null && !subjectTypes.some((t) => t.question_type_id === typeId)) {
      setTypeId(null);
    }
  }, [subjectTypes, typeId]);

  const selected: TopicType | undefined =
    subjectTypes.find((t) => t.question_type_id === typeId);

  function pick(t: TopicType) {
    setTypeId(t.question_type_id);
    setCountText(String(defaultCount(t)));
  }

  const start = useStartTopicPractice((s) =>
    navigate(`/study/practice/${encodeURIComponent(s.id)}`));

  const count = Number(countText);
  const check = selected ? checkCount(selected, count) : null;

  // Starting is always allowed: sessions hold study data, they never gate
  // a new practice (ADR-0015) — no conflict check, no dialog.
  function begin() {
    if (!selected || !level || !check?.ok) return;
    start.mutate({ level, question_type_id: selected.question_type_id, count,
                   feedback_mode: feedback });
  }

  const startError = start.error
    ? (start.error.code === "count_exceeds_available"
        ? "可选数量已变化，请调整后重试。"
        : `无法开始练习：${start.error.message}`)
    : null;

  return (
    <section aria-label="专项练习" className="topic-page">
      <h1>专项练习</h1>
      <p className="text-aux">
        选一个题型，系统会从历年真题中智能抽取：以没做过的题为主，兼顾需要复习的题。
      </p>

      {level === null ? (
        <p role="status">请先在右上角选择备考等级，再选择题型。</p>
      ) : query.isPending ? (
        <p role="status">题型加载中…</p>
      ) : query.error ? (
        <p role={query.error.status === 401 ? "status" : "alert"}>
          {describeLoadError(query.error, "专项练习题型")}
        </p>
      ) : types.length === 0 ? (
        <p>暂无 {level} 可练习的题型。</p>
      ) : (
        <>
          <div className="tabs" role="tablist" aria-label="学科">
            {TOPIC_SUBJECTS.map((s) => (
              <button key={s.key} type="button" role="tab"
                      aria-selected={s.key === subject}
                      onClick={() => setParams({ subject: s.key }, { replace: true })}>
                {s.label}
              </button>
            ))}
          </div>

          {subjectTypes.length === 0 ? (
            <p>{level} 暂无该学科的可练习题型。</p>
          ) : (
            <div role="radiogroup" aria-label="题型" className="topic-types">
              {subjectTypes.map((t) => {
                const noun = unitNoun(t.unit_kind);
                const on = t.question_type_id === typeId;
                return (
                  <label key={t.question_type_id}
                         className={`card topic-type${on ? " is-selected" : ""}`}>
                    <input type="radio" name="topic-type"
                           checked={on} onChange={() => pick(t)} />
                    <span className="topic-type-label">{t.label_zh}</span>
                    <span className="topic-type-ja" lang="ja">{t.label_ja}</span>
                    <span className="topic-type-meta">
                      共 {t.available_units} {noun} · 未练习 {t.new_units} {noun}
                    </span>
                  </label>
                );
              })}
            </div>
          )}

          {selected ? (
            <div className="card topic-config" aria-label="练习设置">
              <h2 className="module-title">{selected.label_zh}</h2>
              <div className="topic-field">
                <label htmlFor="topic-count">
                  数量（{unitNoun(selected.unit_kind)}）
                </label>
                <div className="topic-count">
                  {COUNT_PRESETS.filter((n) => n <= maxCount(selected)).map((n) => (
                    <button key={n} type="button"
                            aria-pressed={count === n}
                            onClick={() => setCountText(String(n))}>
                      {n}
                    </button>
                  ))}
                  <input id="topic-count" type="number" inputMode="numeric"
                         min={1} max={maxCount(selected)} value={countText}
                         onChange={(e) => setCountText(e.target.value)} />
                </div>
                <p className={check?.ok ? "text-aux" : "text-aux topic-warn"}
                   role={check?.ok ? undefined : "alert"}>
                  {check && !check.ok
                    ? check.message
                    : `可选 1–${maxCount(selected)} ${unitNoun(selected.unit_kind)}`}
                </p>
              </div>

              <div className="topic-field" role="radiogroup" aria-label="反馈方式">
                <span className="topic-field-label">反馈方式</span>
                <label className="topic-feedback-option">
                  <input type="radio" name="topic-feedback" checked={feedback === "immediate"}
                         onChange={() => setFeedback("immediate")} />
                  即时反馈（每组提交后看解析）
                </label>
                <label className="topic-feedback-option">
                  <input type="radio" name="topic-feedback" checked={feedback === "end"}
                         onChange={() => setFeedback("end")} />
                  统一反馈（全部结束后揭晓）
                </label>
              </div>

              {selected.is_provisional ? (
                <p className="text-aux">该题型分类仍在核对中，名称可能调整。</p>
              ) : null}

              <button type="button" className="primary"
                      disabled={!check?.ok || start.isPending}
                      onClick={begin}>
                {start.isPending ? "正在抽题…" : "开始练习"}
              </button>
              {startError ? <p role="alert">{startError}</p> : null}
            </div>
          ) : (
            <p className="text-aux">先选择一个题型。</p>
          )}
        </>
      )}

      <p className="text-aux"><Link to="/study/exams">想按年份做完整试卷？去历年试卷</Link></p>
    </section>
  );
}
