import type { ReactNode } from "react";
import { Link } from "react-router";
import type { ExamSummary } from "../../api/dto/exam";
import type { PracticeSession } from "../../api/dto/practice";
import { useCurrentSession, useExamList } from "./useExamCatalog";
import { ButtonLink } from "../../components/Button";

/** Page header copy per design-system.md v1.1 §5.2 + the confirmed home
 * UI reference (docs/design/JLPT GO 2.0 首页.png). */
const PAGE_TITLE = "开始今天的日语练习";
const PAGE_SUBTITLE = "选一个科目，继续提升你的日语能力。";

/** Four-subject entries: first visual focus. Each opens 专项练习 with that
 * subject preselected (`/study/practice?subject=`). Descriptions follow the
 * home UI reference; accent colors are small-area decorative tokens (§2.3). */
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
  const title = continueExamTitle(session, exams) ?? "进行中的练习";
  return (
    <section className="card continue-card" aria-label="继续上次练习">
      <span className="continue-icon" aria-hidden="true"><PlayIcon /></span>
      <div className="continue-info">
        <p className="continue-eyebrow">继续上次练习</p>
        <h2>{title}</h2>
      </div>
      <ButtonLink variant="primary"
            to={`/study/practice/${encodeURIComponent(session.id)}`}>
        继续练习<span aria-hidden="true">→</span>
      </ButtonLink>
    </section>
  );
}

export function StudyHome() {
  const sessionState = useCurrentSession();
  const examList = useExamList().data ?? [];

  return (
    <div className="study-home">
      <header className="home-header">
        <p className="home-eyebrow">MINAO</p>
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
            <Link key={s.key}
                  to={`/study/practice?subject=${s.key}`}
                  className={`card subject-card subject-${s.key}`}>
              <span className="subject-icon" aria-hidden="true">{s.icon}</span>
              <span className="subject-label">{s.label}</span>
              <span className="subject-hint">{s.hint}</span>
              <span className="subject-arrow" aria-hidden="true">→</span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
