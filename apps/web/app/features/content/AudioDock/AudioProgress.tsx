import type { CSSProperties } from "react";

/** Zone C: interactive seek bar + tabular-numeral time readout
 * (audio-player-spec.md §3.C). The range input stays the accessibility
 * surface (role=slider); --progress drives the filled-track gradient. */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "--:--";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function AudioProgress({ currentTime, duration, disabled, onSeek }: {
  currentTime: number;
  duration: number;
  disabled: boolean;
  onSeek(seconds: number): void;
}) {
  const max = duration > 0 ? duration : 1;
  const pct = Math.min(100, (Math.min(currentTime, max) / max) * 100);
  return (
    <div className="audio-progress-zone">
      <input type="range" className="audio-seek" min={0} max={max}
             step={0.1} aria-label="播放进度"
             disabled={disabled || duration <= 0}
             value={Math.min(currentTime, max)}
             style={{ "--progress": `${pct}%` } as CSSProperties}
             onChange={(e) => onSeek(Number(e.target.value))} />
      <span className="audio-time">
        {formatTime(currentTime)} / {formatTime(duration)}
      </span>
    </div>
  );
}
