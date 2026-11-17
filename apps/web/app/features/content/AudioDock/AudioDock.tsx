import { useCallback, useEffect, useRef, useState } from "react";
import { getUnitTranscript } from "../../../api/endpoints/sessions";
import type { TranscriptCue } from "../../../api/dto/practice";
import { AudioInfo } from "./AudioInfo";
import { AudioProgress } from "./AudioProgress";
import { PlaybackControls } from "./PlaybackControls";
import { PlaybackSpeedSelect } from "./PlaybackSpeedSelect";
import { VolumeControl } from "./VolumeControl";
import { TranscriptToggle } from "./TranscriptToggle";
import { TranscriptPanel, type TranscriptViewState } from "./TranscriptPanel";
import { useAudioPlayer } from "./useAudioPlayer";

export interface TranscriptRef {
  sessionId: string;
  sessionUnitId: string;
  /** The reveal gate (audio-player.md §8) evaluated by the practice page
   * from server state: immediate → unit submitted; end → session ended. */
  allowed: boolean;
}

/**
 * Floating Audio Dock (audio-player.md) — exactly ONE instance per
 * practice page, width-matched to the practice content container, fixed
 * 20px above the viewport bottom. UI only: it never touches answers,
 * judging or scoring, and never renders transcript cues until the
 * backend's reveal gate has opened them. The <audio> element lives here
 * permanently, so expanding/collapsing the transcript panel never
 * recreates it or reloads the audio. The page shell must reserve
 * padding-bottom: calc(var(--audio-dock-height) + var(--audio-dock-bottom)
 * + env(safe-area-inset-bottom)).
 */
export function AudioDock({ src, title = "音声", subtitle = null, disabledReason = "音频暂不可用", transcript = null }: {
  src: string | null;
  title?: string;
  subtitle?: string | null;
  disabledReason?: string;
  transcript?: TranscriptRef | null;
}) {
  const api = useAudioPlayer(src);
  const { state } = api;
  const unavailable = src === null;
  const failed = state === "error";
  const controlsDisabled = unavailable;

  const panelId = "transcript-panel";
  const [expanded, setExpanded] = useState(false);
  const [follow, setFollow] = useState(true);
  const [view, setView] = useState<TranscriptViewState | null>(null);
  const loadSeq = useRef(0);

  // Switching units invalidates the previous transcript and closes the
  // panel; the audio element keeps its own src handling.
  useEffect(() => {
    setExpanded(false);
    setView(null);
  }, [transcript?.sessionUnitId]);

  const loadTranscript = useCallback((sessionId: string, sessionUnitId: string, seq: number) => {
    setView({ kind: "loading" });
    getUnitTranscript(sessionId, sessionUnitId)
      .then((payload) => {
        if (loadSeq.current !== seq) return;
        const cues: TranscriptCue[] = payload.materials.flatMap((m) => m.cues);
        setView({ kind: "ready", cues, language: payload.materials[0]?.language ?? null });
      })
      .catch((e: unknown) => {
        if (loadSeq.current !== seq) return;
        const message = e instanceof Error ? e.message : String(e);
        setView({ kind: "error", message });
      });
  }, []);

  const onToggleTranscript = useCallback(() => {
    if (!transcript?.allowed || controlsDisabled) return;
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (view === null && transcript) {
      const seq = ++loadSeq.current;
      loadTranscript(transcript.sessionId, transcript.sessionUnitId, seq);
    }
  }, [expanded, view, transcript, loadTranscript]);

  const currentTimeMs = api.currentTime * 1000;

  return (
    // One floating component: panel (expands upward, in-flow) + control bar
    // share a single shadow/radius/background (audio-player.md Task 2).
    <div className={`audio-dock${expanded ? " is-expanded" : ""}`}
         role="region" aria-label="音频播放器">
      {expanded ? (
        <TranscriptPanel id={panelId} view={view ?? { kind: "loading" }}
                         currentTimeMs={currentTimeMs} follow={follow}
                         onFollowChange={setFollow} onSeek={api.playFrom}
                         onClose={() => setExpanded(false)}
                         onRetry={() => {
                           if (transcript) {
                             const seq = ++loadSeq.current;
                             loadTranscript(transcript.sessionId,
                                            transcript.sessionUnitId, seq);
                           }
                         }} />
      ) : null}
      <div className="audio-dock-bar">
        <AudioInfo title={unavailable ? disabledReason : title} subtitle={subtitle} />
        {failed ? (
          <div className="audio-error" role="alert">
            <span>音频加载失败</span>
            <button type="button" className="audio-retry" onClick={api.retry}>
              重试
            </button>
          </div>
        ) : (
          <>
            <PlaybackControls state={state} disabled={controlsDisabled}
                              onToggle={api.toggle} onSkip={api.skip} />
            <AudioProgress currentTime={api.currentTime} duration={api.duration}
                           disabled={controlsDisabled} onSeek={api.seek} />
            <PlaybackSpeedSelect value={api.playbackRate} disabled={controlsDisabled}
                                 onChange={api.setPlaybackRate} />
            <VolumeControl volume={api.volume} muted={api.muted}
                           disabled={controlsDisabled}
                           onVolume={api.setVolume} onToggleMute={api.toggleMute} />
            {transcript ? (
              <TranscriptToggle expanded={expanded} locked={!transcript.allowed}
                                panelId={panelId}
                                disabled={controlsDisabled || !transcript.allowed}
                                onToggle={onToggleTranscript} />
            ) : null}
          </>
        )}
        <span className="sr-only" aria-live="polite">
          {state === "buffering" ? "正在缓冲" : ""}
        </span>
        <audio ref={api.setElement} src={src ?? undefined} preload="metadata" />
      </div>
    </div>
  );
}
