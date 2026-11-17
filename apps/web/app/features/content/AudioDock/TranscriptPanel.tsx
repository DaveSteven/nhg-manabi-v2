import { useEffect, useMemo, useRef } from "react";
import type { TranscriptCue } from "../../../api/dto/practice";
import { TranscriptCueItem, cueIsActive } from "./TranscriptCueItem";

export type TranscriptViewState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "empty" }
  | { kind: "ready"; cues: TranscriptCue[]; language: string | null;
      /** Paired translated cues by index (audio-player: transcript and its
       * translation are separate Canonical materials). */
      translationByIndex: Map<number, TranscriptCue> | null };

/** Token-styled switch (audio-player.md Task 5) — shared by the follow
 * and Chinese-translation controls; NOT a checkbox. */
function PanelSwitch({ checked, label, onChange }: {
  checked: boolean;
  label: string;
  onChange(next: boolean): void;
}) {
  return (
    <button type="button" role="switch" aria-checked={checked}
            className="follow-switch" aria-label={label}
            onClick={() => onChange(!checked)}>
      <span className="follow-thumb" aria-hidden="true" />
    </button>
  );
}

/**
 * Transcript Panel (audio-player.md §3/§5/§6): the in-flow upper half of
 * the floating dock component (shared shadow/radius/background, light
 * divider between panel and control bar). Independent inner scroll;
 * never changes page layout. Follow playback scrolls the active cue into
 * view and pauses itself when the user scrolls, resuming only via the
 * switch. 中文对照 shows the paired translated cue under each line when
 * the release actually contains a translation material — never fabricated.
 */
export function TranscriptPanel({ id, view, currentTimeMs, follow, onFollowChange, showZh, onShowZhChange, onSeek, onClose, onRetry }: {
  id: string;
  view: TranscriptViewState;
  currentTimeMs: number;
  follow: boolean;
  onFollowChange(next: boolean): void;
  showZh: boolean;
  onShowZhChange(next: boolean): void;
  onSeek(seconds: number): void;
  onClose(): void;
  onRetry(): void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // prefers-reduced-motion: instant jumps instead of smooth scrolling.
  const reducedMotion = useMemo(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  const cues = view.kind === "ready" ? view.cues : [];
  const hasTranslation = view.kind === "ready"
    && view.translationByIndex !== null && view.translationByIndex.size > 0;
  const activeIndex = cues.findIndex((c) => cueIsActive(c, currentTimeMs));

  // Follow playback: bring the active cue into view.
  useEffect(() => {
    if (!follow || activeIndex < 0) return;
    const el = scrollRef.current?.querySelector(
      `[data-cue-index="${cues[activeIndex]!.index}"]`);
    el?.scrollIntoView({ block: "center",
                         behavior: reducedMotion ? "auto" : "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, follow, reducedMotion]);

  // Esc collapses the panel (non-modal: no focus trap, no overlay).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Real user scroll intent pauses auto-follow; programmatic
  // scrollIntoView fires none of wheel/touchmove/scroll-keys.
  const pauseFollow = () => {
    if (follow) onFollowChange(false);
  };

  return (
    <section id={id} className="transcript-panel" aria-label="听力原文">
      <header className="transcript-header">
        <h2>听力原文</h2>
        {view.kind === "ready" && cues.length > 0 ? (
          <>
            {hasTranslation ? (
              <span className="transcript-follow">
                <span className="transcript-follow-label">中文对照</span>
                <PanelSwitch checked={showZh} label="中文对照"
                             onChange={onShowZhChange} />
              </span>
            ) : null}
            <span className="transcript-follow">
              <span className="transcript-follow-label">跟随播放</span>
              <PanelSwitch checked={follow} label="跟随播放"
                           onChange={onFollowChange} />
            </span>
          </>
        ) : null}
        <button type="button" className="transcript-close"
                aria-label="收起原文" onClick={onClose}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none"
               stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
               strokeLinejoin="round" aria-hidden="true">
            <path d="m6 10 6 6 6-6" />
          </svg>
        </button>
      </header>
      <div ref={scrollRef} className="transcript-scroll" tabIndex={0}
           onWheel={pauseFollow} onTouchMove={pauseFollow}
           onKeyDown={(e) => {
             if (["ArrowUp", "ArrowDown", "PageUp", "PageDown",
                  "Home", "End", " "].includes(e.key)) pauseFollow();
           }}>
        {view.kind === "loading" ? (
          <p role="status">原文加载中…</p>
        ) : view.kind === "error" ? (
          <p role="alert">
            原文加载失败：{view.message}
            <button type="button" onClick={onRetry}>重试</button>
          </p>
        ) : view.kind === "empty" || cues.length === 0 ? (
          <p role="status">该组暂无可用原文。</p>
        ) : (
          cues.map((cue) => (
            <TranscriptCueItem key={cue.index} cue={cue}
                               active={cueIsActive(cue, currentTimeMs)}
                               currentTimeMs={currentTimeMs}
                               showZh={showZh}
                               translation={view.kind === "ready"
                                 ? view.translationByIndex?.get(cue.index) ?? null
                                 : null}
                               onSeek={onSeek} />
          ))
        )}
      </div>
    </section>
  );
}
