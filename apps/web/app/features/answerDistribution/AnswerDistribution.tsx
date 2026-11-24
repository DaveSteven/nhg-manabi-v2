import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Breadcrumb } from "../../components/Breadcrumb";
import { Select, type SelectGroup } from "../../components/select";
import { useNavSection } from "../../components/TopNav";
import { describeLoadError, type ApiError } from "../../api/errors";
import type { AnswerDistribution } from "../../api/dto/answerDistribution";
import { getAnswerDistribution } from "../../api/endpoints/answerDistribution";
import { useLevel, JLPT_LEVELS } from "../auth/useLevel";
import { TOPIC_SUBJECTS } from "../topic/topicModel";
import { ALL, SMALL_SAMPLE, formatPercent, summarize } from "./distributionModel";

/**
 * 历年答案分布 `/study/answer-distribution`: how often 选项 1/2/3/4 is the
 * keyed answer across every current published paper. Filters: level
 * (全部 / N5…N1) and question type (全部 / one type). Aggregate only — the
 * page cannot reveal the answer of any particular question.
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
  const [typeId, setTypeId] = useState<string>(ALL);
  const level = levelPick ?? myLevel ?? ALL;

  const data = query.data;
  const summary = useMemo(
    () => (data ? summarize(data, level, typeId) : null), [data, level, typeId]);
  const perType = useMemo(
    () => (data && typeId === ALL
      ? data.types.map((t) => ({ t, s: summarize(data, level, t.question_type_id) }))
          .filter((r) => r.s.total > 0)
      : []),
    [data, level, typeId]);

  const typeItems: SelectGroup[] = useMemo(() => {
    const groups: SelectGroup[] = [
      { label: "", options: [{ value: ALL, label: "全部题型" }] }];
    for (const s of TOPIC_SUBJECTS) {
      const opts = (data?.types ?? []).filter((t) => t.subject === s.key)
        .map((t) => ({ value: t.question_type_id, label: t.label_zh }));
      if (opts.length) groups.push({ label: s.label, options: opts });
    }
    return groups;
  }, [data]);

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
                      onClick={() => setLevelPick(l)}>
                {l === ALL ? "全部" : l}
              </button>
            ))}
          </div>

          <div className="dist-filter">
            <span id="dist-type-label" className="topic-field-label">题型</span>
            <Select value={typeId} onChange={setTypeId} items={typeItems}
                    aria-labelledby="dist-type-label" width={220} />
          </div>

          {summary && summary.total > 0 ? (
            <div className="card dist-card" aria-label="分布">
              <p className="dist-total">
                共 {summary.total} 题
                {summary.total < SMALL_SAMPLE ? (
                  <span className="text-aux">（样本较少，仅供参考）</span>
                ) : null}
              </p>
              <ul className="dist-bars">
                {summary.bars.map((b) => (
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
            </div>
          ) : (
            <p>该范围暂无统计数据。</p>
          )}

          {perType.length > 0 ? (
            <div className="card dist-card" aria-label="各题型">
              <h2 className="module-title">各题型分布</h2>
              <table className="dist-table">
                <thead>
                  <tr>
                    <th scope="col">题型</th>
                    {[1, 2, 3, 4].map((p) => <th key={p} scope="col">选项 {p}</th>)}
                    <th scope="col">题数</th>
                  </tr>
                </thead>
                <tbody>
                  {perType.map(({ t, s }) => (
                    <tr key={t.question_type_id}>
                      <th scope="row">
                        <button type="button" className="dist-link"
                                onClick={() => setTypeId(t.question_type_id)}>
                          {t.label_zh}
                        </button>
                      </th>
                      {[1, 2, 3, 4].map((p) => {
                        const b = s.bars.find((x) => x.position === p);
                        return <td key={p}>{b ? formatPercent(b.percent) : "—"}</td>;
                      })}
                      <td>{s.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
