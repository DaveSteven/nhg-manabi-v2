import { Link, useSearchParams } from "react-router";
import { useEffect, useState } from "react";
import type { ExamSummary } from "../../api/dto/exam";
import { describeLoadError } from "../../api/errors";
import { useExamList } from "./useExamCatalog";
import { examTitle, examRoute } from "./viewModels";
import { useLevel } from "../auth/useLevel";

/**
 * Published exam catalog. Real level/year/month/title only — months are
 * whatever the data contains (no hardcoded July/December assumption).
 * Filters live in URL search params so state survives refresh. The
 * account level preference (ADR-0011) seeds the level filter once on
 * first visit; afterwards the user's explicit URL choice always wins
 * (including clearing it back to 全部).
 */
export function ExamListView() {
  const query = useExamList();
  const [params, setParams] = useSearchParams();
  const { level: preferredLevel } = useLevel();
  const [seeded, setSeeded] = useState(false);
  const level = params.get("level") ?? "";
  const year = params.get("year") ?? "";

  useEffect(() => {
    if (seeded) return;
    setSeeded(true);
    if (preferredLevel && !params.get("level")) {
      const next = new URLSearchParams(params);
      next.set("level", preferredLevel);
      setParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seeded]);

  const data = query.data ?? [];
  const levels = [...new Set(data.map((e) => e.level))];
  const years = [...new Set(data.map((e) => e.year))].sort((a, b) => b - a);
  const filtered = data.filter((e) =>
    (!level || e.level === level) && (!year || String(e.year) === year));

  return (
    <section aria-label="历年试卷目录">
      <h1>历年试卷</h1>

      <div className="exam-filters">
        <label>
          等级{" "}
          <select value={level}
                  onChange={(ev) => updateParam(params, setParams, "level", ev.target.value)}>
            <option value="">全部</option>
            {levels.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </label>
        <label>
          年份{" "}
          <select value={year}
                  onChange={(ev) => updateParam(params, setParams, "year", ev.target.value)}>
            <option value="">全部</option>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
      </div>

      {query.isPending ? (
        <p role="status">加载中…</p>
      ) : query.error ? (
        <p role={query.error.status === 401 ? "status" : "alert"}>
          {describeLoadError(query.error, "试卷目录")}
        </p>
      ) : data.length === 0 ? (
        <p>暂无已发布试卷。</p>
      ) : filtered.length === 0 ? (
        <p>没有符合条件的试卷。</p>
      ) : (
        <ul className="exam-list">
          {filtered.map((e: ExamSummary) => (
            <li key={e.exam_id} className="card exam-row">
              <span className="exam-level">{e.level}</span>
              <span className="exam-title">
                {e.title === examTitle(e) ? examTitle(e)
                  : `${examTitle(e)} · ${e.title}`}
              </span>
              <Link to={examRoute(e.exam_id)}>查看试卷</Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function updateParam(params: URLSearchParams,
                     setParams: (p: URLSearchParams) => void,
                     key: string, value: string) {
  const next = new URLSearchParams(params);
  // Set explicitly even when empty: an empty value must stay distinguishable
  // from "never chosen" so the level preference doesn't re-seed a filter
  // the user just cleared.
  next.set(key, value);
  setParams(next);
}
