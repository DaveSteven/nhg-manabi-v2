import type { AudioPlayerState } from "./useAudioPlayer";
import { Back5Icon, Forward5Icon, PauseIcon, PlayIcon } from "./icons";

const STATE_LABEL: Record<AudioPlayerState, string> = {
  idle: "待播放",
  playing: "播放中",
  paused: "已暂停",
  buffering: "缓冲中",
  error: "加载失败",
};

/** Zone B: ±5s skip flanking the primary 48px play/pause button
 * (audio-player-spec.md §3.B). Buffering disables the toggle so a slow
 * load cannot stack duplicate play() requests. */
export function PlaybackControls({ state, disabled, onToggle, onSkip }: {
  state: AudioPlayerState;
  disabled: boolean;
  onToggle(): void;
  onSkip(delta: number): void;
}) {
  const playing = state === "playing";
  const toggleDisabled = disabled || state === "buffering";
  return (
    <div className="audio-controls">
      <button type="button" className="audio-skip" disabled={disabled}
              aria-label="后退 5 秒" onClick={() => onSkip(-5)}>
        <Back5Icon />
      </button>
      <button type="button" className="audio-toggle" disabled={toggleDisabled}
              aria-label={playing ? "暂停" : "播放"}
              onClick={onToggle}>
        <span aria-hidden="true">{playing ? <PauseIcon /> : <PlayIcon />}</span>
        <span className="sr-only">{STATE_LABEL[state]}</span>
      </button>
      <button type="button" className="audio-skip" disabled={disabled}
              aria-label="前进 5 秒" onClick={() => onSkip(5)}>
        <Forward5Icon />
      </button>
    </div>
  );
}
