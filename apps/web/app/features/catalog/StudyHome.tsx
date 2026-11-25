import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import type { ExamSummary } from "../../api/dto/exam";
import type { PracticeSession } from "../../api/dto/practice";
import { useCurrentSession, useExamList } from "./useExamCatalog";
import { ButtonLink } from "../../components/Button";
import { useAuth } from "../auth/authStore";
import { useStreak } from "../learning/useLearning";
import { JLPT_LEVELS, useLevel, type JlptLevel } from "../auth/useLevel";
import { useStartTopicPractice, useTopicTypes } from "../topic/useTopicPractice";
import { defaultCount, unitNoun } from "../topic/topicModel";
import { Button } from "../../components/Button";
import { nextSitting } from "./examDates";

/** Page header copy per design-system.md v1.1 §5.2 + the confirmed home
 * UI reference (docs/design/JLPT GO 2.0 首页.png). */
const PAGE_TITLE = "从 JLPT 开始，不止于考试";
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

/** First-run step for a signed-in student without a target level: one tap,
 * then the "今天来一组" card takes over. */
function LevelPickCard({ onPick }: { onPick: (level: JlptLevel) => void }) {
  return (
    <section className="card continue-card" aria-label="选择备考等级">
      <div className="continue-info">
        <p className="continue-eyebrow">先选一个备考等级</p>
        <h2>选好后，这里会直接给你今天的第一组题</h2>
        <div className="level-pick">
          {JLPT_LEVELS.map((l) => (
            <Button key={l} variant="secondary" onClick={() => onPick(l)}>{l}</Button>
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * One-tap "next step" when there is nothing to resume: a smart-random topic
 * set at the student's level — the question type with the most never-answered
 * Units (stable provisional-free types first), default size, immediate feedback.
 * Everything shown comes from the real /topic-practice/types counts.
 */
function TodayPracticeCard({ state }: { state: ReturnType<typeof useCurrentSession> }) {
  const auth = useAuth();
  const { level, setLevel } = useLevel();
  const navigate = useNavigate();
  const enabled = auth.user !== null && state.kind === "no-active";
  const types = useTopicTypes(enabled ? level : null);
  const start = useStartTopicPractice((session) => {
    navigate(`/study/practice/${encodeURIComponent(session.id)}`);
  });
  if (enabled && !level) return <LevelPickCard onPick={setLevel} />;
  if (!enabled || !level || !types.data) return null;
  const usable = types.data.types.filter((t) => t.available_units > 0);
  const pool = usable.filter((t) => !t.is_provisional);
  const best = [...(pool.length > 0 ? pool : usable)]
    .sort((a, b) => b.new_units - a.new_units || b.available_units - a.available_units)[0];
  if (!best) return null;
  const count = defaultCount(best);
  return (
    <section className="card continue-card" aria-label="今天来一组">
      <span className="continue-icon" aria-hidden="true"><PlayIcon /></span>
      <div className="continue-info">
        <p className="continue-eyebrow">今天来一组 · {level}</p>
        <h2>{best.label_zh} · {count} {unitNoun(best.unit_kind)}</h2>
        <p className="text-aux">新题为主，兼顾复习。想换题型？<Link to="/study/practice">去专项练习</Link></p>
      </div>
      <Button variant="primary" loading={start.isPending}
              onClick={() => start.mutate({
                level, question_type_id: best.question_type_id, count,
                feedback_mode: "immediate", selection: "smart" })}>
        开始<span aria-hidden="true">→</span>
      </Button>
      {start.error ? <p role="alert">开始失败：{start.error.message}</p> : null}
    </section>
  );
}

const WEEK_LABELS = ["一", "二", "三", "四", "五", "六", "日"];

function ExamCountdownCard() {
  const next = nextSitting(new Date());
  if (!next) return null;
  return (
    <section className="card countdown-card" aria-label="考试倒计时">
      <p className="countdown-chip">{next.sitting.label} · {next.text}</p>
      <p className="countdown-main">
        {next.daysLeft === 0 ? (
          <strong>今天考试</strong>
        ) : (
          <>距考试 <strong>{next.daysLeft}</strong> 天</>
        )}
      </p>
    </section>
  );
}

function StreakCard() {
  const streak = useStreak(true).data;
  return (
    <section className="card streak-card" aria-label="连续学习">
      <div className="streak-head">
        <p className="streak-count">
          <strong>{streak?.streak_days ?? 0}</strong> 天连续
        </p>
        <p className="streak-week">本周 {streak?.week_studied ?? 0}/7</p>
      </div>
      <ol className="streak-days">
        {WEEK_LABELS.map((label, i) => {
          const day = streak?.week[i];
          return (
            <li key={label}
                data-studied={day?.studied ? "true" : "false"}
                aria-current={day?.is_today ? "date" : undefined}>
              <span className="streak-day-label">{label}</span>
              <span className="streak-dot"
                    role="img"
                    aria-label={day?.studied ? "已学习" : "未学习"} />
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function StudyHome() {
  const auth = useAuth();
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
      <TodayPracticeCard state={sessionState} />

      <div className={`progress-row${auth.user ? "" : " is-single"}`}>
        <ExamCountdownCard />
        {auth.user ? <StreakCard /> : null}
      </div>

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
