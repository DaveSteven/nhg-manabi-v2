import { useAudioPlayer } from "./useAudioPlayer";

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "--:--";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

const STATE_LABEL: Record<string, string> = {
  idle: "待播放",
  playing: "播放中",
  paused: "已暂停",
  buffering: "缓冲中",
  error: "加载失败",
};

/**
 * Fixed-bottom audio dock — exactly ONE instance per practice page.
 * First version: play/pause, seek bar, progress, buffering and explicit
 * failure states (text + icon, never color alone). The page shell must
 * reserve padding-bottom: calc(var(--audio-dock-height) +
 * env(safe-area-inset-bottom)) so the dock never covers options or the
 * submit button on 360/390px screens.
 */
export function AudioPlayer({ src }: { src: string | null }) {
  const api = useAudioPlayer(src);
  const { state } = api;

  return (
    <div className="audio-dock" role="region" aria-label="音频播放器">
      {state === "error" ? (
        <p className="audio-error" role="alert">
          <span aria-hidden="true">⚠️</span> 音频加载失败，请检查网络后重试。
        </p>
      ) : (
        <>
          <button type="button" className="audio-toggle"
                  onClick={api.toggle}
                  aria-label={state === "playing" ? "暂停" : "播放"}>
            <span aria-hidden="true">{state === "playing" ? "⏸" : "▶"}</span>
            <span className="sr-only">{STATE_LABEL[state]}</span>
          </button>
          <input type="range" className="audio-seek" min={0}
                 max={api.duration > 0 ? api.duration : 1} step={0.1}
                 value={Math.min(api.currentTime, api.duration || 1)}
                 aria-label="播放进度"
                 disabled={api.duration <= 0}
                 onChange={(e) => api.seek(Number(e.target.value))} />
          <span className="audio-time">
            {formatTime(api.currentTime)} / {formatTime(api.duration)}
          </span>
          <span className="audio-state" aria-live="polite">
            {STATE_LABEL[state]}
          </span>
        </>
      )}
      <audio ref={api.setElement} src={src ?? undefined} preload="metadata" />
    </div>
  );
}
