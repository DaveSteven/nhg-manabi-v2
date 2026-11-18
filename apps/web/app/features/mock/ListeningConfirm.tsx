import { Button } from "../../components/Button";
import { formatClock } from "./mockModel";

/**
 * 聴解 start confirmation (ADR-0022). The listening recording plays
 * continuously from the moment the user confirms; the click itself starts the
 * sound (browsers require a user gesture), then the answer page opens.
 */
export function ListeningConfirm({ title, remaining, audioMs, questions, onConfirm }: {
  title: string;
  remaining: number | null;
  audioMs: number;
  questions: number;
  onConfirm(): void;
}) {
  return (
    <main className="exam-main container">
      <section className="listen-confirm card" aria-labelledby="listen-confirm-title">
        <span className="listen-confirm-icon" aria-hidden="true">🎧</span>
        <h1 id="listen-confirm-title">{title}即将开始</h1>
        <dl className="listen-confirm-facts">
          <div><dt>题目</dt><dd>{questions} 题</dd></div>
          <div><dt>录音时长</dt><dd>约 {Math.round(audioMs / 60000)} 分钟</dd></div>
          <div><dt>本阶段剩余</dt><dd>{remaining === null ? "—" : formatClock(remaining)}</dd></div>
        </dl>
        <ul className="listen-confirm-rules">
          <li>确认后进入答题页面并<strong>自动开始播放</strong>，整段录音连续播放到结束。</li>
          <li>播放过程中不能暂停、拖动进度、调整倍速或重播。</li>
          <li>选择答案、打开答题卡、切换大题都不会影响播放。</li>
          <li>刷新或断网后只能从当前时间点继续，已经播放的部分不会重播。</li>
          <li>请先戴好耳机、调好音量。</li>
        </ul>
        <Button variant="primary" onClick={onConfirm}>确认开始听力考试</Button>
      </section>
    </main>
  );
}
