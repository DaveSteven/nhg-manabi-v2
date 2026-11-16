import type { ReactNode } from "react";
import { Link } from "react-router";
import { describeLoadError } from "../../api/errors";
import type { ExamSummary } from "../../api/dto/exam";
import type { PracticeSession } from "../../api/dto/practice";
import { useLevel } from "../auth/useLevel";
import { useCurrentSession, useExamList } from "./useExamCatalog";
import { examRoute } from "./viewModels";

/** Page header copy per design-system.md v1.1 §5.2 + the confirmed home
 * UI reference (docs/design/JLPT GO 2.0 首页.png). */
const PAGE_TITLE = "开始今天的日语练习";
const PAGE_SUBTITLE = "选一个科目，继续提升你的日语能力。";

/** Four-subject entries: first visual focus. Topic practice by subject is
 * not in M2.2 scope — entries show an explicit 暂未开放 state (P-002 keeps
 * them visible; no fake navigation). Descriptions follow the home UI
 * reference; accent colors are small-area decorative tokens (§2.3). */
const SUBJECTS: {
  key: string;
  label: string;
  hint: string;
  icon: ReactNode;
}[] = [
  {
    key: "vocabulary",
    label: "文字词汇",
    hint: "汉字读音与词语用法",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
           strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
           aria-hidden="true">
        <path d="M12 6c-1.8-1.6-4.2-2-8-2v14c3.8 0 6.2.4 8 2 1.8-1.6 4.2-2 8-2V4c-3.8 0-6.2.4-8 2z" />
        <path d="M12 6v14" />
      </svg>
    ),
  },
  {
    key: "grammar",
    label: "文法",
    hint: "句型结构与语法运用",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
           strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
           aria-hidden="true">
        <rect x="4" y="4" width="16" height="16" rx="2.5" />
        <path d="M8 9h8M8 12.5h8M8 16h4.5" />
      </svg>
    ),
  },
  {
    key: "reading",
    label: "读解",
    hint: "理解文章与提取信息",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
           strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
           aria-hidden="true">
        <path d="M7 3.5h10v17H7z" />
        <path d="M10 8h4M10 11.5h4M10 15h2.5" />
      </svg>
    ),
  },
  {
    key: "listening",
    label: "听力",
    hint: "听懂对话与关键信息",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
           strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
           aria-hidden="true">
        <path d="M4 13a8 8 0 0 1 16 0" />
        <rect x="3" y="13" width="4" height="6.5" rx="1.8" />
        <rect x="17" y="13" width="4" height="6.5" rx="1.8" />
      </svg>
    ),
  },
];

/**
 * Continue-card title from the session's own release binding matched
 * against the published catalog — derived real data only; falls back to
 * a neutral label when the catalog is unavailable or a session spans
 * several releases.
 */
function continueExamTitle(session: PracticeSession,
                           exams: ExamSummary[]): string | null {
  const first = session.units[0];
  if (!first || exams.length === 0) return null;
  const releases = new Set(session.units.map((u) => u.release_id));
  if (releases.size !== 1) return null;
  const exam = exams.find((e) => e.release_id === first.release_id);
  return exam ? `${exam.level} · ${exam.year}年${exam.month}月试卷` : null;
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
         aria-hidden="true">
      <rect x="4" y="5.5" width="16" height="15" rx="2.5" />
      <path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8.5 5.8a1 1 0 0 1 1.53-.85l9.2 5.9a1 1 0 0 1 0 1.7l-9.2 5.9a1 1 0 0 1-1.53-.85z" />
    </svg>
  );
}

function ContinueSessionCard({ state, exams }: {
  state: ReturnType<typeof useCurrentSession>;
  exams: ExamSummary[];
}) {
  if (state.kind !== "active") return null;
  const session = state.session;
  const submitted = session.units.filter((u) => u.state === "submitted").length;
  const title = continueExamTitle(session, exams) ?? "进行中的练习";
  return (
    <section className="card continue-card" aria-label="继续上次练习">
      <span className="continue-icon" aria-hidden="true"><PlayIcon /></span>
      <div className="continue-info">
        <p className="continue-eyebrow">继续上次练习</p>
        <h2>{title}</h2>
        <p className="continue-meta">
          已提交 {submitted} / {session.units.length} 组 · 从上次的位置继续
        </p>
      </div>
      <Link className="primary-link"
            to={`/study/practice/${encodeURIComponent(session.id)}`}>
        继续练习<span aria-hidden="true">→</span>
      </Link>
    </section>
  );
}

export function StudyHome() {
  const sessionState = useCurrentSession();
  const exams = useExamList();
  const examList = exams.data ?? [];
  // Target level (signed-in profile, or the guest's stored choice) filters
  // the home exam entry; the continue card still sees the full catalog.
  const { level } = useLevel();
  const levelExams = level ? examList.filter((e) => e.level === level) : examList;

  return (
    <div className="study-home">
      <header className="home-header">
        <p className="home-eyebrow">JLPT GO 2.0</p>
        <h1>{PAGE_TITLE}</h1>
        <p className="home-subtitle">{PAGE_SUBTITLE}</p>
      </header>

      <ContinueSessionCard state={sessionState} exams={examList} />

      <section aria-label="专项练习入口">
        <div className="section-head">
          <h2>专项练习</h2>
          <p className="section-hint">按题型强化训练，逐步提升</p>
        </div>
        <div className="subject-grid">
          {SUBJECTS.map((s) => (
            <button key={s.key} type="button"
                    className={`card subject-card subject-${s.key}`}
                    aria-disabled="true">
              <span className="subject-icon" aria-hidden="true">{s.icon}</span>
              <span className="subject-label">{s.label}</span>
              <span className="subject-hint">{s.hint}</span>
              <span className="subject-status">专项练习暂未开放 · 可先用历年试卷</span>
              <span className="subject-arrow" aria-hidden="true">→</span>
            </button>
          ))}
        </div>
      </section>

      <section aria-label="历年试卷入口" className="exam-entry">
        <div className="section-head">
          <h2>历年试卷</h2>
          {level ? (
            <Link className="level-chip" to="/study/account"
                  aria-label={`备考等级 ${level}，前往用户中心修改`}>
              {level}
            </Link>
          ) : null}
          <p className="section-hint">按年份进行完整练习，熟悉考试形式</p>
          <Link className="section-more" to="/study/exams">
            查看全部<span aria-hidden="true"> →</span>
          </Link>
        </div>
        {exams.isPending ? (
          <p role="status">试卷目录加载中…</p>
        ) : exams.error ? (
          <p role={exams.error.status === 401 ? "status" : "alert"}>
            {describeLoadError(exams.error, "试卷目录")}
          </p>
        ) : levelExams.length === 0 ? (
          <p>{level && examList.length > 0
            ? `暂无 ${level} 已发布试卷，可在「查看全部」中选择其他等级。`
            : "暂无已发布试卷。"}</p>
        ) : (
          <ul className="exam-quick-list">
            {[...levelExams]
              .sort((a, b) => b.year - a.year || b.month - a.month)
              .slice(0, 3)
              .map((e) => (
              <li key={e.exam_id}>
                <Link className="card exam-quick"
                      to={examRoute(e.exam_id)}>
                  <span className="exam-quick-icon" aria-hidden="true">
                    <CalendarIcon />
                  </span>
                  <span className="exam-quick-info">
                    <span className="exam-quick-year">{e.year}年</span>
                    <span className="exam-quick-meta">{e.month}月</span>
                  </span>
                  <span className="exam-level">{e.level}</span>
                  <span className="chevron" aria-hidden="true">›</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
