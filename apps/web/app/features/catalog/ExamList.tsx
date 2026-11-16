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
  // Month columns come from the data (no hardcoded 7月/12月): when at most 4
  // distinct months exist and no row has two exams in the same month, each
  // capsule sits in its month's column so e.g. a lone 12月 lines up with the
  // other rows' 12月. Otherwise capsules simply flow into two columns.
  const months = [...new Set(filtered.map((e) => e.month))].sort((a, b) => a - b);
  // newest year first; within a year: 7月, 12月 … (month ascending, then level)
  const rows = years
    .map((y) => ({
      year: y,
      items: filtered.filter((e) => e.year === y)
        .sort((a, b) => a.month - b.month || a.level.localeCompare(b.level)),
    }))
    .filter((r) => r.items.length > 0);
  const aligned = months.length >= 1 && months.length <= 4 &&
    rows.every((r) => new Set(r.items.map((e) => e.month)).size === r.items.length);
  const columns = aligned ? months.length : 2;

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
        <ol className="exam-years">
          {rows.map(({ year: y, items }) => (
            <li key={y} className="exam-year-row" aria-label={`${y}年`}>
              <span className="exam-year" aria-hidden="true">{y}</span>
              <ul className="exam-chips"
                  style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
                {items.map((e: ExamSummary) => (
                  <li key={e.exam_id}
                      style={aligned ? { gridColumn: months.indexOf(e.month) + 1 }
                        : undefined}>
                    <Link className="exam-chip" to={examRoute(e.exam_id)}
                          aria-label={`${examTitle(e)}，${e.question_count} 题`}
                          title={e.title === examTitle(e) ? undefined : e.title}>
                      <span>{e.month}月</span>
                      {level ? null : (
                        <span className="exam-chip-level">{e.level}</span>
                      )}
                      <span className="exam-chip-count" aria-hidden="true">
                        {e.question_count} 题
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
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
