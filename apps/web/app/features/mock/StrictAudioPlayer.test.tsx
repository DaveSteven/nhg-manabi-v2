import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "../../test/mocks/server";
import { renderRoutes } from "../../test/render";
import { authStore } from "../auth/authStore";
import { MockExamPage } from "./MockExam";
import { StrictAudioPlayer, liveStatus, type LiveAudio } from "./StrictAudioPlayer";

beforeAll(() => server.listen());
afterEach(() => { server.resetHandlers(); authStore.clear(); window.localStorage.clear(); });
afterAll(() => server.close());

let play: ReturnType<typeof vi.fn>;
beforeEach(() => {
  play = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, value: play });
  Object.defineProperty(HTMLMediaElement.prototype, "pause", { configurable: true, value: vi.fn() });
});

const st = (state: LiveAudio["state"], pos = 0): LiveAudio =>
  ({ material_id: "m-a", state, position_ms: pos, duration_ms: 30000, at: Date.now() });

function setup(status: LiveAudio, server_state?: Partial<LiveAudio>) {
  const calls: string[] = [];
  const seen: LiveAudio[] = [];
  server.use(http.post("*/api/mock-exams/m-1/units/su-1/audio/m-a/start", () => {
    calls.push("start");
    return HttpResponse.json({ material_id: "m-a", state: "playing", position_ms: 0,
      duration_ms: 30000, ...server_state });
  }));
  render(<StrictAudioPlayer sessionId="m-1" sessionUnitId="su-1" materialId="m-a"
           src="/audio.mp3" status={status} onStatus={(_, n) => seen.push(n)} />);
  return { calls, seen };
}

describe("StrictAudioPlayer", () => {
  it("has no pause, seek, speed, replay or scrub control — only one start button", () => {
    setup(st("idle"));
    expect(screen.getByRole("button", { name: "开始播放（仅一次）" })).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(document.querySelector("audio")?.hasAttribute("controls")).toBe(false);
    expect(document.querySelector("input[type=range]")).toBeNull();
    expect(screen.getByText(/不能暂停、回退或重播/)).toBeInTheDocument();
  });

  it("start claims the playback on the server, then plays and says it cannot be paused", async () => {
    const user = userEvent.setup();
    const { calls, seen } = setup(st("idle"));
    await user.click(screen.getByRole("button", { name: "开始播放（仅一次）" }));
    await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
    expect(calls).toEqual(["start"]);
    expect(await screen.findByText("播放中 · 不可暂停")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();     // no way to restart
    expect(seen[0]).toMatchObject({ state: "playing" });
  });

  it("an audio already started offers only to CONTINUE at the live position", async () => {
    const user = userEvent.setup();
    setup(st("playing", 12000), { position_ms: 12500 });
    expect(screen.getByText("音频已经开始，不能重新开始")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "继续播放" }));
    await waitFor(() => expect(play).toHaveBeenCalled());
    expect(document.querySelector("audio")!.currentTime).toBeCloseTo(12.5, 1);
  });

  it("a consumed audio can never be played again", async () => {
    const { calls } = setup(st("ended", 30000));
    expect(screen.getByText("播放结束")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(calls).toEqual([]);
    expect(play).not.toHaveBeenCalled();
  });

  it("a playing status keeps advancing off-screen and turns ended on time", () => {
    const s = st("playing", 10000);
    expect(liveStatus(s, s.at + 5000).position_ms).toBe(15000);
    expect(liveStatus(s, s.at + 25000)).toMatchObject({ state: "ended", position_ms: 30000 });
    expect(liveStatus({ ...s, duration_ms: null }, s.at + 1000).state).toBe("ended");
  });

  it("a server refusal is shown, not swallowed", async () => {
    const user = userEvent.setup();
    server.use(http.post("*/api/mock-exams/m-1/units/su-1/audio/m-a/start", () =>
      HttpResponse.json({ detail: { code: "unit_not_in_active_phase", message: "此时不可播放" } },
                        { status: 409 })));
    render(<StrictAudioPlayer sessionId="m-1" sessionUnitId="su-1" materialId="m-a"
             src="/audio.mp3" status={st("idle")} onStatus={() => {}} />);
    await user.click(screen.getByRole("button", { name: "开始播放（仅一次）" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("此时不可播放");
    expect(play).not.toHaveBeenCalled();
  });
});

describe("listening unit in the exam page", () => {
  it("shows the strict player (not a normal dock) with the server status", async () => {
    authStore.setSession("tok", { id: "u1", email: "a@example.com", display_name: "x",
      current_level: "N2" as const, avatar: null });
    const rt = (t: string) => ({ format: "jlptgo-richtext-v1" as const,
      blocks: [{ type: "paragraph" as const, children: [{ type: "text" as const, text: t }] }] });
    const listening = {
      release_id: "r-1", id: "u-l", layer_id: "ly", question_type_id: "t", kind: "single",
      position: 1, label: null, slot_ids: [], conversion_status: "complete" as const,
      materials: [{ id: "m-a", kind: "audio", role: "primary", language: "ja", content: null,
                    asset_id: "as-1" }],
      questions: [{ id: "q1", question_type_id: "t", position: 1, printed_number: "1",
        prompt: null, slot_id: null, conversion_status: "complete",
        options: [{ id: "q1-a", position: 1, content: rt("選択肢") }] }],
      session_unit_id: "su-1", session_unit_state: "pending",
      audio: [{ material_id: "m-a", state: "idle", position_ms: 0, duration_ms: 30000 }],
      layer: { layer_id: "ly", label: "問題1", position: 1, subject: "listening",
               section_title: "聴解" },
    };
    const now = new Date();
    server.use(
      http.get("*/api/mock-exams/m-1", () => HttpResponse.json({
        id: "m-1", mode: "mock", state: "in_progress", exam_id: "E", exam_title: "t",
        level: "N2", release_id: "r-1", created_at: "x", ended_at: null,
        server_now: now.toISOString(), active_phase_id: "p2", results_available: false,
        phases: [{ phase_id: "p2", position: 1, title: "聴解", duration_seconds: 3000,
          playback_policy: { playback: "once" }, unit_count: 1, status: "active",
          started_at: "x", expires_at: new Date(now.getTime() + 3000_000).toISOString(),
          remaining_seconds: 3000 }],
        active_units: [{ session_unit_id: "su-1", unit_id: "u-l", position: 1, state: "pending" }] })),
      http.get("*/api/mock-exams/m-1/content", () =>
        HttpResponse.json({ phase_id: "p2", units: [listening] })),
      http.get("*/api/mock-exams/m-1/drafts", () => HttpResponse.json({ drafts: [] })));
    renderRoutes([{ path: "mock/:id", Component: () => <MockExamPage sessionId="m-1" /> }],
                 "/mock/m-1");
    expect(await screen.findByRole("button", { name: "开始播放（仅一次）" })).toBeInTheDocument();
    expect(screen.queryByText(/尚未接入/)).not.toBeInTheDocument();
    expect(document.querySelector(".audio-dock")).toBeNull();
  });
});
