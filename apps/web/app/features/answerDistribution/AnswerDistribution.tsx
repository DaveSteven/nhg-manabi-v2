import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Breadcrumb } from "../../components/Breadcrumb";
import { useNavSection } from "../../components/TopNav";
import { describeLoadError, type ApiError } from "../../api/errors";
import type { AnswerDistribution } from "../../api/dto/answerDistribution";
import { getAnswerDistribution } from "../../api/endpoints/answerDistribution";
import { useLevel, JLPT_LEVELS } from "../auth/useLevel";
import { TOPIC_SUBJECTS } from "../topic/topicModel";
import { ALL, SMALL_SAMPLE, formatPercent, summarize, tint } from "./distributionModel";

/**
 * 历年答案分布 `/study/answer-distribution`: how often 选项 1/2/3/4 is the
 * keyed answer across every current published paper. Level tabs on top; one
 * heat-map row per question type (colour = clear deviation from an even
 * split, never for small samples); clicking a row opens its bars in place.
 * Aggregate only — it cannot reveal the answer of any particular question.
 */
export function AnswerDistributionView() {
  useNavSection("topic");
  const { level: myLevel } = useLevel();
  const query = useQuery<AnswerDistribution, ApiError>({
    queryKey: ["answer-distribution"],
    queryFn: ({ signal }) => getAnswerDistribution(signal),
    retry: false,
  });
  const [levelPick, setLevelPick] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const level = levelPick ?? myLevel ?? ALL;

  const data = query.data;
  const overall = useMemo(
    () => (data ? summarize(data, level, ALL) : null), [data, level]);
  const rows = useMemo(
    () => (data
      ? data.types.map((t) => ({ t, s: summarize(data, level, t.question_type_id) }))
          .filter((r) => r.s.total > 0)
      : []),
    [data, level]);

  return (
    <section aria-label="历年答案分布" className="topic-page">
      <Breadcrumb items={[{ label: "专项练习", to: "/study/practice" },
                          { label: "历年答案分布" }]} />
      <h1>历年答案分布</h1>
      <p className="text-aux">
        统计题库中当前所有历年试卷的正确答案落在各选项的比例，只含汇总，
        不显示具体题目。基于题库当前答案，尚未全部人工校对。
      </p>

      {query.isPending ? (
        <p role="status">加载中…</p>
      ) : query.error ? (
        <p role={query.error.status === 401 ? "status" : "alert"}>
          {query.error.status === 401
            ? "请先登录后查看答案分布。"
            : describeLoadError(query.error, "答案分布")}
        </p>
      ) : (
        <>
          <div className="tabs" role="tablist" aria-label="等级">
            {[ALL, ...JLPT_LEVELS].map((l) => (
              <button key={l} type="button" role="tab" aria-selected={l === level}
                      onClick={() => { setLevelPick(l); setOpen(null); }}>
                {l === ALL ? "全部" : l}
              </button>
            ))}
          </div>

          {overall && overall.total > 0 ? (
            <div className="card dist-card" aria-label="总体分布">
              <p className="dist-total">全部题型 · 共 {overall.total} 题</p>
              <Bars bars={overall.bars} />
            </div>
          ) : (
            <p>该等级暂无统计数据。</p>
          )}

          {rows.length > 0 ? (
            <div className="card dist-card" aria-label="各题型">
              <h2 className="module-title">各题型分布</h2>
              <p className="text-aux dist-legend">
                <span className="dist-swatch is-high" aria-hidden="true" />明显偏高
                <span className="dist-swatch is-low" aria-hidden="true" />明显偏低
                <span className="dist-legend-note">无色＝与平均无明显差异；样本不足 {SMALL_SAMPLE} 题不着色。点题型查看详情。</span>
              </p>
              <div className="dist-heat" role="table" aria-label="题型分布热力图">
                <div className="dist-heat-row dist-heat-head" role="row">
                  <span role="columnheader">题型</span>
                  {[1, 2, 3, 4].map((p) => (
                    <span key={p} role="columnheader">选项 {p}</span>
                  ))}
                  <span role="columnheader">题数</span>
                </div>
                {rows.map(({ t, s }, i) => {
                  const cells = tint(s);
                  // a subject heading above its first type (文字词汇/文法/读解/听力)
                  const newSubject = i === 0 || rows[i - 1]!.t.subject !== t.subject;
                  const isOpen = open === t.question_type_id;
                  const small = s.total < SMALL_SAMPLE;
                  return (
                    <Fragment key={t.question_type_id}>
                      {newSubject ? (
                        <div className="dist-heat-group" role="presentation">
                          {TOPIC_SUBJECTS.find((x) => x.key === t.subject)?.label ?? t.subject}
                        </div>
                      ) : null}
                      <button type="button" role="row"
                              className={`dist-heat-row dist-heat-item${small ? " is-small" : ""}`}
                              aria-expanded={isOpen}
                              onClick={() => setOpen(isOpen ? null : t.question_type_id)}>
                        <span role="rowheader" className="dist-heat-name">{t.label_zh}</span>
                        {[1, 2, 3, 4].map((p) => {
                          const c = cells.find((x) => x.position === p);
                          return (
                            <span key={p} role="cell"
                                  className={`dist-cell${c && c.tone !== "none" ? ` is-${c.tone}` : ""}`}
                                  style={c && c.tone !== "none"
                                    ? { ["--strength" as string]: c.strength } : undefined}>
                              {c ? formatPercent(c.percent) : "—"}
                            </span>
                          );
                        })}
                        <span role="cell" className="dist-heat-count">
                          {s.total}{small ? <em>样本少</em> : null}
                        </span>
                      </button>
                      {isOpen ? (
                        <div className="dist-detail" role="region"
                             aria-label={`${t.label_zh} 详情`}>
                          <Bars bars={s.bars} />
                        </div>
                      ) : null}
                    </Fragment>
                  );
                })}
              </div>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function Bars({ bars }: { bars: { position: number; count: number; percent: number }[] }) {
  return (
    <ul className="dist-bars">
      {bars.map((b) => (
        <li key={b.position}>
          <span className="dist-pos">选项 {b.position}</span>
          <span className="dist-track" aria-hidden="true">
            <span className="dist-fill" style={{ width: `${b.percent}%` }} />
          </span>
          <span className="dist-value">
            {formatPercent(b.percent)}
            <span className="dist-count"> · {b.count} 题</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
