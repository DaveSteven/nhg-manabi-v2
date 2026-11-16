import { useCallback, useEffect, useRef, useState } from "react";

export type AudioPlayerState =
  | "idle"
  | "playing"
  | "paused"
  | "buffering"
  | "error";

export interface AudioPlayerApi {
  state: AudioPlayerState;
  currentTime: number;
  duration: number;
  toggle(): void;
  seek(seconds: number): void;
  setElement(el: HTMLAudioElement | null): void;
}

/**
 * Browser-lifecycle-only audio player hook (ADR-0007: nothing runs at
 * prerender). Wraps an <audio> element rendered by the component via a
 * ref; first version supports play/pause/seek/progress/loading/failure —
 * no strict mock-exam playback restrictions here.
 */
export function useAudioPlayer(src: string | null): AudioPlayerApi {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState<AudioPlayerState>("idle");
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const setElement = useCallback((el: HTMLAudioElement | null) => {
    audioRef.current = el;
  }, []);

  useEffect(() => {
    setState("idle");
    setCurrentTime(0);
    setDuration(0);
  }, [src]);

  const toggle = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      const p = el.play();
      if (p && typeof p.catch === "function") {
        p.catch(() => setState("error"));
      }
    } else {
      el.pause();
    }
  }, []);

  const seek = useCallback((seconds: number) => {
    const el = audioRef.current;
    if (!el) return;
    const d = el.duration;
    if (!Number.isFinite(d)) return;
    el.currentTime = Math.min(Math.max(0, seconds), d);
  }, []);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onPlay = () => setState("playing");
    const onPause = () => setState((s) => (s === "error" ? s : "paused"));
    const onWaiting = () => setState("buffering");
    const onPlaying = () => setState("playing");
    const onEnded = () => setState("paused");
    const onTime = () => setCurrentTime(el.currentTime);
    const onMeta = () => setDuration(el.duration);
    const onError = () => setState("error");

    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("waiting", onWaiting);
    el.addEventListener("playing", onPlaying);
    el.addEventListener("ended", onEnded);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("error", onError);
    return () => {
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("waiting", onWaiting);
      el.removeEventListener("playing", onPlaying);
      el.removeEventListener("ended", onEnded);
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("error", onError);
    };
  }, [src]);

  return {
    state,
    currentTime,
    duration,
    toggle,
    seek,
    setElement,
  };
}
