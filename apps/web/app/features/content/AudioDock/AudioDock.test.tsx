import { describe, expect, it, beforeEach, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithQuery } from "../../../test/render";
import { AudioDock } from "./AudioDock";
import { getUnitTranscript } from "../../../api/endpoints/sessions";
import type { TranscriptPayload } from "../../../api/dto/practice";

/**
 * happy-dom provides HTMLMediaElement stubs; play()/pause() exist but no
 * media events fire on their own. Component tests dispatch events through
 * fireEvent (act-wrapped) on the element to pin the state machine. This
 * does NOT prove real audio playback — real-browser walkthrough covers it.
 * Transcript behaviour is tested with a mocked sessions endpoint: the
 * backend reveal gate itself is proven by backend/tests/test_transcript_gate.py.
 */
vi.mock("../../../api/endpoints/sessions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../api/endpoints/sessions")>();
  return { ...actual, getUnitTranscript: vi.fn() };
});

const mockTranscript = vi.mocked(getUnitTranscript);

const CUES = [
  { index: 1, start_ms: 0, end_ms: 12000,
    children: [{ type: "text", text: "女：すみません、この近くに……" }] },
  { index: 2, start_ms: 12000, end_ms: 18000,
    children: [{ type: "text", text: "男：はい、ありますよ。" }] },
  { index: 3, start_ms: null, end_ms: null,
    children: [{ type: "text", text: "（時間未校準の文）" }] },
];

function transcriptPayload(cues = CUES): TranscriptPayload {
  return {
    session_unit_id: "su-1", unit_id: "u-1", release_id: "r-1",
    feedback_mode: "immediate",
    materials: [{ material_id: "m-1", kind: "transcript",
                  language: "ja-JP", cues }],
  };
}

function getAudio(): HTMLAudioElement {
  const el = document.querySelector("audio");
  if (!el) throw new Error("audio element not rendered");
  return el;
}

function fire(el: EventTarget, type: string) {
  // RTL fireEvent wraps dispatch in act() so state updates flush.
  fireEvent(el as Element, new Event(type));
}

const DOCK_PROPS = {
  src: "/api/releases/r/assets/a.mp3",
  subtitle: "练习 · 组 1",
};

beforeEach(() => {
  mockTranscript.mockReset();
  // happy-dom media stubs — deterministic duration for seek tests.
  Object.defineProperty(getAudio, "duration", { value: 30, configurable: true });
});

describe("AudioDock", () => {
  it("renders one floating dock with play, seek, speed, volume", () => {
    renderWithQuery(<AudioDock {...DOCK_PROPS} />);
    expect(screen.getAllByRole("region", { name: "音频播放器" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "播放" })).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "播放进度" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "播放速度" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "音量" })).toBeInTheDocument();
    expect(screen.getByText("练习 · 组 1")).toBeInTheDocument();
    expect(document.querySelectorAll("audio")).toHaveLength(1);
  });

  it("toggle switches to playing on play event and back on pause", () => {
    renderWithQuery(<AudioDock {...DOCK_PROPS} />);
    const audio = getAudio();
    vi.spyOn(audio, "play").mockResolvedValue();

    fireEvent.click(screen.getByRole("button", { name: "播放" }));
    fire(audio, "play");
    expect(screen.getByRole("button", { name: "暂停" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "暂停" }));
    fire(audio, "pause");
    expect(screen.getByRole("button", { name: "播放" })).toBeInTheDocument();
  });

  it("updates time display on timeupdate with real currentTime", () => {
    renderWithQuery(<AudioDock {...DOCK_PROPS} />);
    const audio = getAudio();
    Object.defineProperty(audio, "duration", { value: 76, configurable: true });
    Object.defineProperty(audio, "currentTime", { value: 2, configurable: true });
    fire(audio, "loadedmetadata");
    fire(audio, "timeupdate");
    expect(screen.getByText("0:02 / 1:16")).toBeInTheDocument();
  });

  it("seek clamps to duration", () => {
    renderWithQuery(<AudioDock {...DOCK_PROPS} />);
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
  });

  it("skip buttons move ±5s and clamp to [0, duration]", () => {
    renderWithQuery(<AudioDock {...DOCK_PROPS} />);
    const audio = getAudio();
    Object.defineProperty(audio, "duration", { value: 30, configurable: true });
    const assignments: number[] = [];
    Object.defineProperty(audio, "currentTime", {
      configurable: true,
      get: () => assignments.at(-1) ?? 0,
      set: (v: number) => assignments.push(v),
    });
    fire(audio, "loadedmetadata");
    fireEvent.click(screen.getByRole("button", { name: "前进 5 秒" }));
    expect(assignments).toEqual([5]);
    fireEvent.click(screen.getByRole("button", { name: "后退 5 秒" }));
    expect(assignments).toEqual([5, 0]);
    fireEvent.click(screen.getByRole("button", { name: "后退 5 秒" }));
    expect(assignments).toEqual([5, 0, 0]);
    fireEvent.click(screen.getByRole("button", { name: "前进 5 秒" }));
    fire(audio, "timeupdate"); // sync state so the next skip starts at 5
    fireEvent.click(screen.getByRole("button", { name: "前进 5 秒" }));
    fireEvent.click(screen.getByRole("button", { name: "前进 5 秒" }));
    // 5 → 10 → 15, never beyond duration
    expect(assignments.at(-1)).toBe(15);
  });

  it("ended keeps progress at the end; play restarts from 0", () => {
    renderWithQuery(<AudioDock {...DOCK_PROPS} />);
    const audio = getAudio();
    Object.defineProperty(audio, "duration", { value: 30, configurable: true });
    let t = 30;
    Object.defineProperty(audio, "currentTime", {
      configurable: true,
      get: () => t,
      set: (v: number) => { t = v; },
    });
    const playSpy = vi.spyOn(audio, "play").mockResolvedValue();
    fire(audio, "loadedmetadata");
    fire(audio, "ended");
    expect(t).toBe(30); // progress stays at the end

    fireEvent.click(screen.getByRole("button", { name: "播放" }));
    expect(t).toBe(0); // restart from the beginning
    expect(playSpy).toHaveBeenCalled();
  });

  it("buffering disables the toggle, then recovers", () => {
    renderWithQuery(<AudioDock {...DOCK_PROPS} />);
    const audio = getAudio();
    fire(audio, "waiting");
    expect(screen.getByRole("button", { name: "播放" })).toBeDisabled();
    fire(audio, "playing");
    // recovered: the toggle is enabled again, now labelled 暂停 (playing)
    expect(screen.getByRole("button", { name: "暂停" })).toBeEnabled();
  });

  it("error event shows explicit failure with retry", () => {
    renderWithQuery(<AudioDock {...DOCK_PROPS} />);
    fire(getAudio(), "error");
    expect(screen.getByRole("alert")).toHaveTextContent("音频加载失败");
    const loadSpy = vi.spyOn(getAudio(), "load").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(loadSpy).toHaveBeenCalled();
  });

  it("play() rejection lands in error state", async () => {
    renderWithQuery(<AudioDock {...DOCK_PROPS} />);
    vi.spyOn(getAudio(), "play").mockRejectedValue(new Error("denied"));
    fireEvent.click(screen.getByRole("button", { name: "播放" }));
    await vi.waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("音频加载失败");
    });
  });

  it("speed select applies playbackRate to the audio element", async () => {
    renderWithQuery(<AudioDock {...DOCK_PROPS} />);
    const audio = getAudio();
    fireEvent.click(screen.getByRole("combobox", { name: "播放速度" }));
    fireEvent.click(await screen.findByRole("option", { name: "1.5×" }));
    expect(audio.playbackRate).toBe(1.5);
  });
});

describe("AudioDock transcript panel", () => {
  const TRANSCRIPT = { sessionId: "s-1", sessionUnitId: "su-1", allowed: true };

  it("locked state: disabled toggle with lock hint, no fetch", () => {
    renderWithQuery(<AudioDock {...DOCK_PROPS}
      transcript={{ ...TRANSCRIPT, allowed: false }} />);
    const btn = screen.getByRole("button", { name: "原文（提交后可查看）" });
    expect(btn).toBeDisabled();
    expect(mockTranscript).not.toHaveBeenCalled();
  });

  it("expands upward, loads cues, aria-expanded reflects state", async () => {
    mockTranscript.mockResolvedValue(transcriptPayload());
    renderWithQuery(<AudioDock {...DOCK_PROPS} transcript={TRANSCRIPT} />);
    const btn = screen.getByRole("button", { name: "原文" });
    expect(btn).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(btn);
    expect(await screen.findByRole("region", { name: "听力原文" })).toBeInTheDocument();
    expect(btn).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("女：すみません、この近くに……")).toBeInTheDocument();
    expect(screen.getByText("男：はい、ありますよ。")).toBeInTheDocument();
  });

  it("highlights the active cue via start_ms <= t < end_ms", async () => {
    mockTranscript.mockResolvedValue(transcriptPayload());
    renderWithQuery(<AudioDock {...DOCK_PROPS} transcript={TRANSCRIPT} />);
    fireEvent.click(screen.getByRole("button", { name: "原文" }));
    await screen.findByText("男：はい、ありますよ。");
    const audio = getAudio();
    Object.defineProperty(audio, "currentTime", { value: 13, configurable: true });
    fire(audio, "timeupdate");
    const active = await waitFor(() =>
      document.querySelector('.transcript-cue.is-active[data-cue-index="2"]'));
    expect(active).not.toBeNull();
    expect(active!.getAttribute("aria-current")).toBe("true");
    expect(document.querySelector('.transcript-cue.is-active[data-cue-index="1"]')).toBeNull();
  });

  it("clicking a cue seeks to start_ms and plays", async () => {
    mockTranscript.mockResolvedValue(transcriptPayload());
    renderWithQuery(<AudioDock {...DOCK_PROPS} transcript={TRANSCRIPT} />);
    fireEvent.click(screen.getByRole("button", { name: "原文" }));
    await screen.findByText("男：はい、ありますよ。");
    const audio = getAudio();
    Object.defineProperty(audio, "duration", { value: 30, configurable: true });
    let t = 0;
    Object.defineProperty(audio, "currentTime", {
      configurable: true, get: () => t, set: (v: number) => { t = v; },
    });
    const playSpy = vi.spyOn(audio, "play").mockResolvedValue();
    fireEvent.click(screen.getByRole("button", { name: /播放 0:12 – 0:18/ }));
    expect(t).toBe(12);
    expect(playSpy).toHaveBeenCalled();
  });

  it("invalid timestamps render as non-clickable, unguessed text", async () => {
    mockTranscript.mockResolvedValue(transcriptPayload());
    renderWithQuery(<AudioDock {...DOCK_PROPS} transcript={TRANSCRIPT} />);
    fireEvent.click(screen.getByRole("button", { name: "原文" }));
    expect(await screen.findByText("（時間未校準の文）")).toBeInTheDocument();
    expect(screen.getByText("时间未校准")).toBeInTheDocument();
    expect(document.querySelector('.transcript-cue[data-cue-index="3"].is-seekable')).toBeNull();
  });

  it("no cue materials shows the empty state", async () => {
    mockTranscript.mockResolvedValue(transcriptPayload([]));
    renderWithQuery(<AudioDock {...DOCK_PROPS} transcript={TRANSCRIPT} />);
    fireEvent.click(screen.getByRole("button", { name: "原文" }));
    expect(await screen.findByText("该组暂无可用原文。")).toBeInTheDocument();
  });

  it("fetch failure shows an error with retry", async () => {
    mockTranscript.mockRejectedValue(new Error("boom"));
    renderWithQuery(<AudioDock {...DOCK_PROPS} transcript={TRANSCRIPT} />);
    fireEvent.click(screen.getByRole("button", { name: "原文" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("原文加载失败");
    mockTranscript.mockResolvedValue(transcriptPayload());
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByText("男：はい、ありますよ。")).toBeInTheDocument();
  });

  it("expand/collapse never recreates the audio element or plays", async () => {
    mockTranscript.mockResolvedValue(transcriptPayload());
    renderWithQuery(<AudioDock {...DOCK_PROPS} transcript={TRANSCRIPT} />);
    const audio = getAudio();
    const playSpy = vi.spyOn(audio, "play").mockResolvedValue();
    fireEvent.click(screen.getByRole("button", { name: "原文" }));
    await screen.findByText("男：はい、ありますよ。");
    fireEvent.click(screen.getByRole("button", { name: "收起原文" }));
    expect(screen.queryByRole("region", { name: "听力原文" })).not.toBeInTheDocument();
    expect(playSpy).not.toHaveBeenCalled();
    expect(document.querySelector("audio")).toBe(audio); // same instance
    fireEvent.keyDown(window, { key: "Escape" }); // Esc on closed panel: no-op
    // expand again: still one audio element, still the same node
    fireEvent.click(screen.getByRole("button", { name: "原文" }));
    await screen.findByText("男：はい、ありますよ。");
    expect(document.querySelectorAll("audio")).toHaveLength(1);
    expect(document.querySelector("audio")).toBe(audio);
  });

  it("switching units closes the panel and refetches", async () => {
    mockTranscript.mockResolvedValue(transcriptPayload());
    const { rerender } = renderWithQuery(
      <AudioDock {...DOCK_PROPS} transcript={TRANSCRIPT} />);
    fireEvent.click(screen.getByRole("button", { name: "原文" }));
    await screen.findByText("男：はい、ありますよ。");
    rerender(<AudioDock {...DOCK_PROPS}
      transcript={{ ...TRANSCRIPT, sessionUnitId: "su-2" }} />);
    expect(screen.queryByRole("region", { name: "听力原文" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "原文" }));
    await screen.findByText("男：はい、ありますよ。");
    expect(mockTranscript).toHaveBeenCalledTimes(2);
  });
});
