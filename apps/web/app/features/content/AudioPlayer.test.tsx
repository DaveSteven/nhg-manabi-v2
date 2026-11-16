import { describe, expect, it, beforeEach, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithQuery } from "../../test/render";
import { AudioPlayer } from "./AudioPlayer";

/**
 * happy-dom provides HTMLMediaElement stubs; play()/pause() exist but no
 * media events fire on their own. Component tests dispatch events through
 * fireEvent (act-wrapped) on the element to pin the state machine. This
 * does NOT prove real audio playback — the browser smoke check (real
 * endpoint + real file) covers that; full E2E media verification is M2.3.
 */
function getAudio(): HTMLAudioElement {
  const el = document.querySelector("audio");
  if (!el) throw new Error("audio element not rendered");
  return el;
}

function fire(el: EventTarget, type: string) {
  // RTL fireEvent wraps dispatch in act() so state updates flush.
  fireEvent(el as Element, new Event(type));
}

beforeEach(() => {
  // happy-dom media stubs — deterministic duration for seek tests.
  Object.defineProperty(getAudio, "duration", { value: 30, configurable: true });
});

describe("AudioPlayer", () => {
  it("renders one dock instance with toggle, seek bar and state", () => {
    renderWithQuery(<AudioPlayer src="/api/releases/r/assets/a.mp3" />);
    expect(screen.getAllByRole("region", { name: "音频播放器" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "播放" })).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "播放进度" })).toBeInTheDocument();
    expect(document.querySelectorAll("audio")).toHaveLength(1);
  });

  it("toggle switches to playing on play event and back on pause", () => {
    renderWithQuery(<AudioPlayer src="/api/releases/r/assets/a.mp3" />);
    const audio = getAudio();
    const playSpy = vi.spyOn(audio, "play").mockResolvedValue();
    const pauseSpy = vi.spyOn(audio, "pause").mockReturnValue();

    fireEvent.click(screen.getByRole("button", { name: "播放" }));
    fire(audio, "play");
    expect(screen.getAllByText("播放中").length).toBeGreaterThan(0);

    fire(audio, "timeupdate");
    // timeupdate with no currentTime set: stays 0
    expect(screen.getByText(/0:00/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "暂停" }));
    fire(audio, "pause");
    expect(screen.getAllByText("已暂停").length).toBeGreaterThan(0);
    void playSpy; void pauseSpy;
  });

  it("updates time display on timeupdate with real currentTime", () => {
    renderWithQuery(<AudioPlayer src="/api/releases/r/assets/a.mp3" />);
    const audio = getAudio();
    Object.defineProperty(audio, "duration", { value: 61, configurable: true });
    Object.defineProperty(audio, "currentTime", { value: 61, configurable: true });
    fire(audio, "loadedmetadata");
    fire(audio, "timeupdate");
    expect(screen.getByText("1:01 / 1:01")).toBeInTheDocument();
  });

  it("seek clamps to duration", () => {
    renderWithQuery(<AudioPlayer src="/api/releases/r/assets/a.mp3" />);
    const audio = getAudio();
    Object.defineProperty(audio, "duration", { value: 30, configurable: true });
    const assignments: number[] = [];
    Object.defineProperty(audio, "currentTime", {
      configurable: true,
      get: () => assignments.at(-1) ?? 0,
      set: (v: number) => assignments.push(v),
    });
    fire(audio, "loadedmetadata");
    const slider = screen.getByRole("slider", { name: "播放进度" });
    fireEvent.change(slider, { target: { value: "99" } });
    expect(assignments).toEqual([30]);
    // Real browsers fire timeupdate after seek; sync React state so the
    // controlled slider reflects 30 before the next change.
    fire(audio, "timeupdate");
    const slider2 = screen.getByRole("slider", { name: "播放进度" });
    fireEvent.change(slider2, { target: { value: "0" } });
    expect(assignments).toEqual([30, 0]);
  });

  it("buffering state shows and recovers on playing", () => {
    renderWithQuery(<AudioPlayer src="/api/releases/r/assets/a.mp3" />);
    const audio = getAudio();
    fire(audio, "waiting");
    expect(screen.getAllByText("缓冲中").length).toBeGreaterThan(0);
    fire(audio, "playing");
    expect(screen.getAllByText("播放中").length).toBeGreaterThan(0);
  });

  it("error event shows explicit failure with retry guidance", () => {
    renderWithQuery(<AudioPlayer src="/api/releases/r/assets/a.mp3" />);
    fire(getAudio(), "error");
    expect(screen.getByRole("alert")).toHaveTextContent("音频加载失败");
    // failure replaces controls — no dead toggle button
    expect(screen.queryByRole("button", { name: "播放" })).not.toBeInTheDocument();
  });

  it("play() rejection lands in error state", async () => {
    renderWithQuery(<AudioPlayer src="/api/releases/r/assets/a.mp3" />);
    const audio = getAudio();
    vi.spyOn(audio, "play").mockRejectedValue(new Error("denied"));
    fireEvent.click(screen.getByRole("button", { name: "播放" }));
    await vi.waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("音频加载失败");
    });
  });
});
