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
  playbackRate: number;
  volume: number;
  muted: boolean;
  toggle(): void;
  seek(seconds: number): void;
  /** Seek then play immediately (transcript cue click). */
  playFrom(seconds: number): void;
  /** Move the playhead by `delta` seconds, clamped to [0, duration]. */
  skip(delta: number): void;
  setPlaybackRate(rate: number): void;
  setVolume(v: number): void;
  toggleMute(): void;
  /** Re-attempt loading after an error (clears the state, reloads media). */
  retry(): void;
  setElement(el: HTMLAudioElement | null): void;
}

/**
 * Browser-lifecycle-only audio player hook (ADR-0007: nothing runs at
 * prerender). Wraps an <audio> element rendered by the component via a
 * ref; supports play/pause/seek/skip/progress/playbackRate/volume,
 * loading and failure states, and restart-from-beginning after Ended.
 * Ordinary practice only — strict mock playback restrictions are a
 * server decision and are NOT encoded here (audio-player-spec.md §7).
 */
export function useAudioPlayer(src: string | null): AudioPlayerApi {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState<AudioPlayerState>("idle");
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setRateState] = useState(1);
  const [volume, setVolumeState] = useState(1);
  const [muted, setMutedState] = useState(false);

  const setElement = useCallback((el: HTMLAudioElement | null) => {
    audioRef.current = el;
  }, []);

  useEffect(() => {
    setState("idle");
    setCurrentTime(0);
    setDuration(0);
  }, [src]);

  const endedRef = useRef(false);

  const toggle = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (!el.paused) {
      el.pause();
      return;
    }
    // Ended: progress stays at the end; pressing play restarts from 0.
    if (endedRef.current) {
      endedRef.current = false;
      try { el.currentTime = 0; } catch { /* not seekable yet */ }
      setCurrentTime(0);
    }
    const p = el.play();
    if (p && typeof p.catch === "function") {
      p.catch(() => setState("error"));
    }
  }, []);

  const seek = useCallback((seconds: number) => {
    const el = audioRef.current;
    if (!el) return;
    const d = el.duration;
    if (!Number.isFinite(d)) return;
    const clamped = Math.min(Math.max(0, seconds), d);
    endedRef.current = clamped >= d;
    el.currentTime = clamped;
  }, []);

  const skip = useCallback((delta: number) => {
    const el = audioRef.current;
    if (!el) return;
    seek(el.currentTime + delta);
  }, [seek]);

  const playFrom = useCallback((seconds: number) => {
    const el = audioRef.current;
    if (!el) return;
    endedRef.current = false;
    seek(seconds);
    if (el.paused) {
      const p = el.play();
      if (p && typeof p.catch === "function") {
        p.catch(() => setState("error"));
      }
    }
  }, [seek]);

  const setPlaybackRate = useCallback((rate: number) => {
    setRateState(rate);
    const el = audioRef.current;
    if (el) el.playbackRate = rate;
  }, []);

  const setVolume = useCallback((v: number) => {
    const clamped = Math.min(Math.max(0, v), 1);
    setVolumeState(clamped);
    const el = audioRef.current;
    if (el) {
      el.volume = clamped;
      if (clamped > 0) {
        el.muted = false;
        setMutedState(false);
      }
    }
  }, []);

  const toggleMute = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    el.muted = !el.muted;
    setMutedState(el.muted);
  }, []);

  const retry = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    setState("idle");
    endedRef.current = false;
    setCurrentTime(0);
    el.load();
  }, []);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onPlay = () => {
      endedRef.current = false;
      // A load can reset element-level settings; re-assert user prefs.
      el.playbackRate = playbackRate;
      setState("playing");
    };
    const onPause = () => setState((s) => (s === "error" ? s : "paused"));
    const onWaiting = () => setState("buffering");
    const onPlaying = () => setState("playing");
    const onEnded = () => {
      // Stop at the end; toggle() restarts from the beginning.
      endedRef.current = true;
      setState("paused");
    };
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
    // playbackRate is read at play time via closure; exclude from deps so
    // the listener set is stable per src.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  return {
    state,
    currentTime,
    duration,
    playbackRate,
    volume,
    muted,
    toggle,
    seek,
    playFrom,
    skip,
    setPlaybackRate,
    setVolume,
    toggleMute,
    retry,
    setElement,
  };
}
