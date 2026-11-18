import { Button } from "../../components/Button";
import { formatClock, timeTone, type TimeTone } from "./mockModel";

/** Sticky exam status bar: brand · exam · where I am · progress · clock ·
 * answer sheet. The sheet button sits right of the clock on every layout. */
export function ExamTopBar({ examName, examTitle, where, answered, total,
  remaining, onOpenSheet, onAbandon, saveProblem }: {
  examName: string;
  examTitle: string;
  where: string;
  answered: number;
  total: number;
  remaining: number | null;
  onOpenSheet(): void;
  onAbandon(): void;
  saveProblem: boolean;
}) {
  const tone: TimeTone = remaining === null ? "normal" : timeTone(remaining);
  const pct = total ? Math.round((answered / total) * 100) : 0;
  return (
    <div className="exam-bar-wrap">
    <header className="exam-bar">
      <div className="exam-bar-brand">
        <img src="/favicon.svg" alt="" width={26} height={26} />
        <img className="exam-bar-wordmark" src="/minao-wordmark.svg" alt="MINAO"
             width={82} height={21} />
      </div>
      <strong className="exam-bar-title" title={examTitle}>{examName}</strong>
      <span className="exam-bar-where">{where}</span>
      <div className="exam-bar-progress" aria-label={`已答 ${answered} / ${total}`}>
        <span>已答 {answered} / {total}</span>
        <span className="exam-progress-track" aria-hidden="true">
          <span style={{ width: `${pct}%` }} />
        </span>
      </div>
      {saveProblem ? (
        <span className="exam-save-problem" role="alert">答案保存失败，请检查网络</span>
      ) : null}
      <span className={`exam-clock tone-${tone}`} role="timer" aria-label="剩余时间">
        {remaining === null ? "--:--" : formatClock(remaining)}
      </span>
      <Button variant="secondary" size="sm" onClick={onOpenSheet}>答题卡</Button>
      <Button variant="ghost" size="sm" onClick={onAbandon}>放弃考试</Button>
    </header>
    </div>
  );
}
