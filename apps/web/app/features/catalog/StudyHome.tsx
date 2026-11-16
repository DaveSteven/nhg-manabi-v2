import { Link } from "react-router";
import { useCurrentSession, useExamList } from "./useExamCatalog";
import { examTitle } from "./viewModels";

/** Four-subject entries: first visual focus. Topic practice by subject is
 * not in M2.2 scope — entries show an explicit 暂未开放 state (P-002 keeps
 * them visible; no fake navigation). */
const SUBJECTS = [
  { key: "vocabulary", label: "文字词汇", hint: "单题限时训练" },
  { key: "grammar", label: "文法", hint: "接续与句型" },
  { key: "reading", label: "读解", hint: "短篇到长篇" },
  { key: "listening", label: "听力", hint: "課題理解到統合理解" },
];

function ContinueSessionCard({ state }: { state: ReturnType<typeof useCurrentSession> }) {
  if (state.kind !== "active") return null;
  const first = state.session.units[0];
  return (
    <section className="card continue-card" aria-label="继续上次练习">
      <h2>继续上次练习</h2>
      <p>
        进行中的练习（{state.session.units.filter((u) => u.state === "submitted").length}
        /{state.session.units.length} 组已提交）
      </p>
      <Link className="primary-link"
            to={`/study/practice/${encodeURIComponent(state.session.id)}`}>
        继续练习
      </Link>
      {first ? (
        <p className="sr-only">
          首个 Unit: {first.unit_id}
        </p>
      ) : null}
    </section>
  );
}

export function StudyHome() {
  const sessionState = useCurrentSession();
  const exams = useExamList();

  return (
    <div className="study-home">
      <ContinueSessionCard state={sessionState} />

      <section aria-label="四学科入口">
        <div className="subject-grid">
          {SUBJECTS.map((s) => (
            <button key={s.key} type="button" className="card subject-card"
                    aria-disabled="true">
              <span className="subject-label">{s.label}</span>
              <span className="subject-hint">{s.hint}</span>
              <span className="subject-status">专项练习暂未开放 · 可先用历年试卷</span>
            </button>
          ))}
        </div>
      </section>

      <section aria-label="历年试卷入口" className="exam-entry">
        <h2>历年试卷</h2>
        {exams.isPending ? (
          <p role="status">试卷目录加载中…</p>
        ) : exams.error ? (
          exams.error.status === 401 ? (
            <p role="status">未登录，无法加载试卷目录。</p>
          ) : (
            <p role="alert">试卷目录加载失败，请稍后重试。</p>
          )
        ) : exams.data.length === 0 ? (
          <p>暂无已发布试卷。</p>
        ) : (
          <ul className="exam-entry-list">
            {exams.data.slice(0, 5).map((e) => (
              <li key={e.exam_id}>
                <Link to={`/study/exams/${encodeURIComponent(e.exam_id)}`}>
                  {examTitle(e)}
                </Link>
              </li>
            ))}
          </ul>
        )}
        <p>
          <Link to="/study/exams">查看全部试卷</Link>
        </p>
      </section>
    </div>
  );
}
