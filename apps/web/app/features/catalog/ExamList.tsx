import { Link, useSearchParams } from "react-router";
import type { ExamSummary } from "../../api/dto/exam";
import { describeLoadError } from "../../api/errors";
import { useExamList } from "./useExamCatalog";
import { Select } from "../../components/select";
import { examTitle, examRoute } from "./viewModels";
import { useLevel } from "../auth/useLevel";

/**
 * Published exam catalog. Real level/year/month/title only — months are
 * whatever the data contains (no hardcoded July/December assumption).
 * There is no level filter here: the list follows the student's target
 * level (header selector / profile, or the guest's stored choice) and shows
 * every level when none is set. The year filter lives in the URL search
 * params so it survives refresh.
 */
export function ExamListView() {
  const query = useExamList();
  const [params, setParams] = useSearchParams();
  const { level } = useLevel();
  const year = params.get("year") ?? "";

  const data = query.data ?? [];
  const byLevel = level ? data.filter((e) => e.level === level) : data;
  const years = [...new Set(byLevel.map((e) => e.year))].sort((a, b) => b - a);
  const yearItems = [{ value: "", label: "全部" },
    ...years.map((y) => ({ value: String(y), label: `${y}` }))];
  const filtered = byLevel.filter((e) => !year || String(e.year) === year);

  return (
    <section aria-label="历年试卷目录">
      <h1>历年试卷</h1>

      <div className="exam-filters">
        <div className="select-field">
          <span id="exam-filter-year">年份</span>
          <Select aria-labelledby="exam-filter-year" value={year}
                  items={yearItems}
                  onChange={(v) => updateParam(params, setParams, "year", v)} />
        </div>
      </div>

      {query.isPending ? (
        <p role="status">加载中…</p>
      ) : query.error ? (
        <p role={query.error.status === 401 ? "status" : "alert"}>
          {describeLoadError(query.error, "试卷目录")}
        </p>
      ) : data.length === 0 ? (
        <p>暂无已发布试卷。</p>
      ) : byLevel.length === 0 ? (
        <p>暂无 {level} 已发布试卷，可在右上角切换备考等级。</p>
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
  if (value) next.set(key, value);
  else next.delete(key);
  setParams(next);
}
