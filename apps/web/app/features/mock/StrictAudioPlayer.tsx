import { useCallback, useEffect, useRef, useState } from "react";
import type { AudioStatus } from "../../api/dto/mock";
import { ApiError } from "../../api/errors";
import { startMockAudio } from "../../api/endpoints/mock";
import { Button } from "../../components/Button";
import { formatClock } from "./mockModel";

type Mode = "idle" | "resume" | "playing" | "ended" | "error";

/** Live status as of `at` (device ms): a playing audio keeps advancing on the
 * server timeline even while this component is not mounted. */
export interface LiveAudio extends AudioStatus { at: number }

export function liveStatus(s: LiveAudio, now = Date.now()): AudioStatus {
  if (s.state !== "playing") return s;
  const pos = s.position_ms + (now - s.at);
  if (s.duration_ms === null || pos >= s.duration_ms) {
    return { ...s, state: "ended", position_ms: s.duration_ms ?? s.position_ms };
  }
  return { ...s, position_ms: pos };
}

/**
 * Strict exam audio (ADR-0019 M3): played ONCE on the server's timeline.
 * No pause, no seek, no replay, no speed control, no transcript. Pressing the
 * button claims the playback on the server; a refresh or a return from another
 * 大題 can only CONTINUE at the live position, never restart. Answering is not
 * blocked while the audio runs.
 */
export function StrictAudioPlayer({ sessionId, sessionUnitId, materialId, src,
  status, onStatus }: {
  sessionId: string;
  sessionUnitId: string;
  materialId: string;
  src: string | null;
  status: LiveAudio;
  onStatus(materialId: string, next: LiveAudio): void;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const anchor = useRef<{ wall: number; pos: number } | null>(null);
  const initial = liveStatus(status);
  const [mode, setMode] = useState<Mode>(
    initial.state === "ended" ? "ended" : initial.state === "playing" ? "resume" : "idle");
  const [posMs, setPosMs] = useState(initial.position_ms);
  const [durMs, setDurMs] = useState<number | null>(initial.duration_ms);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  // unmounting (leaving this 大題) stops the sound; the server clock runs on
  useEffect(() => () => { audio.current?.pause(); }, []);

  const begin = useCallback(async () => {
    setProblem(null);
    setBusy(true);
    try {
      const s = await startMockAudio(sessionId, sessionUnitId, materialId);
      onStatus(materialId, { ...s, at: Date.now() });
      setDurMs(s.duration_ms);
      if (s.state === "ended") { setMode("ended"); setPosMs(s.duration_ms ?? 0); return; }
      const el = audio.current;
      if (!el || !src) { setMode("error"); setProblem("音频暂不可用"); return; }
      anchor.current = { wall: Date.now(), pos: s.position_ms };
      if (s.position_ms > 500) el.currentTime = s.position_ms / 1000;
      setMode("playing");
      await el.play();
    } catch (e) {
      setMode("error");
      setProblem(e instanceof ApiError ? e.message : "音频播放失败");
    } finally {
      setBusy(false);
    }
  }, [materialId, onStatus, sessionId, sessionUnitId, src]);

  const tick = () => {
    const el = audio.current;
    if (el && modeRef.current === "playing") setPosMs(Math.round(el.currentTime * 1000));
  };

  return (
    <div className="strict-audio card" data-mode={mode} role="group" aria-label="听力音频">
      <audio ref={audio} src={src ?? undefined} preload="auto"
             onTimeUpdate={tick}
             onEnded={() => { setMode("ended"); onStatus(materialId, {
               material_id: materialId, state: "ended",
               position_ms: durMs ?? posMs, duration_ms: durMs, at: Date.now() }); }}
             // the exam audio cannot be paused: a stray pause (media keys,
             // devtools) resumes immediately
             onPause={() => {
               const el = audio.current;
               if (el && modeRef.current === "playing" && !el.ended) void el.play().catch(() => {});
             }}
             // …and cannot be moved: a seek snaps back to the live position
             onSeeking={() => {
               const el = audio.current; const a = anchor.current;
               if (!el || !a || modeRef.current !== "playing") return;
               const live = (a.pos + (Date.now() - a.wall)) / 1000;
               if (Math.abs(el.currentTime - live) > 1.5) el.currentTime = live;
             }}
             onError={() => {
               if (modeRef.current === "playing") {
                 setMode("error"); setProblem("音频加载中断，可继续播放（从当前时间点继续）");
               }
             }} />
      <div className="strict-audio-head">
        <span aria-hidden="true">🎧</span>
        <strong>听力</strong>
        <span className="text-aux">
          {mode === "idle" ? "音频只播放一次，播放后不能暂停、回退或重播"
            : mode === "resume" ? "音频已经开始，不能重新开始"
            : mode === "playing" ? "播放中 · 不可暂停"
            : mode === "ended" ? "播放结束" : "播放中断"}
        </span>
      </div>
      <div className="strict-audio-track" role="progressbar" aria-label="播放进度"
           aria-valuemin={0} aria-valuemax={durMs ?? 0} aria-valuenow={posMs}>
        <span style={{ width: durMs ? `${Math.min(100, (posMs / durMs) * 100)}%` : "0%" }} />
      </div>
      <div className="strict-audio-foot">
        <span className="strict-audio-time">
          {formatClock(posMs / 1000)} / {durMs === null ? "--:--" : formatClock(durMs / 1000)}
        </span>
        {mode === "idle" ? (
          <Button variant="primary" loading={busy} onClick={begin}>开始播放（仅一次）</Button>
        ) : null}
        {mode === "resume" || mode === "error" ? (
          <Button variant="primary" loading={busy} onClick={begin}>继续播放</Button>
        ) : null}
      </div>
      {problem ? <p role="alert" className="text-aux">{problem}</p> : null}
    </div>
  );
}
