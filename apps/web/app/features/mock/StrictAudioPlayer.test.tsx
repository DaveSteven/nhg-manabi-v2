import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "../../test/mocks/server";
import { renderRoutes } from "../../test/render";
import { authStore } from "../auth/authStore";
import { ApiError } from "../../api/errors";
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

function renderListeningExam(opts: { phaseAudio?: unknown; units?: number } = {}) {
    authStore.setSession("tok", { id: "u1", email: "a@example.com", display_name: "x",
      current_level: "N2" as const, avatar: null });
    const rt = (t: string) => ({ format: "jlptgo-richtext-v1" as const,
      blocks: [{ type: "paragraph" as const, children: [{ type: "text" as const, text: t }] }] });
    const mk = (n: number) => ({
      release_id: "r-1", id: `u-l${n}`, layer_id: `ly${n}`, question_type_id: "t", kind: "single",
      position: 1, label: null, slot_ids: [], conversion_status: "complete" as const,
      materials: opts.phaseAudio ? [] : [{ id: "m-a", kind: "audio", role: "primary",
                    language: "ja", content: null, asset_id: "as-1" }],
      questions: [{ id: `q${n}`, question_type_id: "t", position: 1, printed_number: `${n}`,
        prompt: null, slot_id: null, conversion_status: "complete",
        options: [{ id: `q${n}-a`, position: 1, content: rt(`選択肢${n}`) }] }],
      session_unit_id: `su-${n}`, session_unit_state: "pending",
      audio: opts.phaseAudio ? []
        : [{ material_id: "m-a", state: "idle", position_ms: 0, duration_ms: 30000 }],
      layer: { layer_id: `ly${n}`, label: `問題${n}`, position: n, subject: "listening",
               section_title: "聴解" },
    });
    const units = Array.from({ length: opts.units ?? 1 }, (_, i) => mk(i + 1));
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
        active_units: units.map((u, i) => ({ session_unit_id: u.session_unit_id,
          unit_id: u.id, position: i + 1, state: "pending" })) })),
      http.get("*/api/mock-exams/m-1/content", () =>
        HttpResponse.json({ phase_id: "p2", phase_audio: opts.phaseAudio ?? null, units })),
      http.get("*/api/mock-exams/m-1/drafts", () => HttpResponse.json({ drafts: [] })));
    renderRoutes([{ path: "mock/:id", Component: () => <MockExamPage sessionId="m-1" /> }],
                 "/mock/m-1");
}

describe("listening unit in the exam page", () => {
  it("shows the strict player (not a normal dock) with the server status", async () => {
    renderListeningExam();
    expect(await screen.findByRole("button", { name: "开始播放（仅一次）" })).toBeInTheDocument();
    expect(screen.queryByText(/尚未接入/)).not.toBeInTheDocument();
    expect(document.querySelector(".audio-dock")).toBeNull();
  });
});

describe("continuous listening phase (ADR-0022, exam-mini)", () => {
  const PA = { asset_id: "full-1", state: "idle", position_ms: 0, duration_ms: 2400000 };
  const okDrafts = http.put("*/api/mock-exams/m-1/units/:su/drafts", async ({ request, params }) => {
    const b = await request.json() as { question_id: string; chosen_option_id: string };
    return HttpResponse.json({ session_unit_id: params.su, question_id: b.question_id,
      chosen_option_id: b.chosen_option_id, row_version: 1, updated_at: "x" });
  });

  it("asks for confirmation first: no questions, no player visible, nothing started", async () => {
    renderListeningExam({ phaseAudio: PA, units: 2 });
    expect(await screen.findByRole("button", { name: "确认开始听力考试" })).toBeInTheDocument();
    expect(screen.getByText(/自动开始播放/)).toBeInTheDocument();
    expect(screen.getByText("约 40 分钟")).toBeInTheDocument();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(document.querySelector(".exam-listen-mini")).toHaveAttribute("hidden");
    expect(play).not.toHaveBeenCalled();
    // the ONE player is already mounted (so the confirm click can start it)
    expect(document.querySelectorAll("audio")).toHaveLength(1);
    expect(document.querySelector("audio")!.getAttribute("src"))
      .toBe("/api/releases/r-1/assets/full-1");
  });

  it("confirm starts the PHASE audio in the same click; answering, the sheet and 大题 changes never touch it", async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    server.use(http.post("*/api/mock-exams/m-1/phases/p2/audio/start", () => {
      calls.push("phase");
      return HttpResponse.json({ ...PA, state: "playing", position_ms: 0 });
    }), okDrafts);
    renderListeningExam({ phaseAudio: PA, units: 2 });
    await user.click(await screen.findByRole("button", { name: "确认开始听力考试" }));
    // play() is called synchronously inside the click (user-gesture unlock)
    expect(play).toHaveBeenCalled();
    expect(await screen.findByRole("radio", { name: "選択肢1" })).toBeInTheDocument();
    await waitFor(() => expect(calls).toEqual(["phase"]));
    const mini = document.querySelector(".exam-listen-mini")!;
    expect(mini).not.toHaveAttribute("hidden");
    expect(await within(mini as HTMLElement).findByRole("button", { name: "播放中，不可暂停" }))
      .toBeDisabled();
    // a short pill: only the play button and the progress bar
    expect(within(mini as HTMLElement).getAllByRole("button")).toHaveLength(1);
    expect(within(mini as HTMLElement).getByRole("progressbar")).toBeInTheDocument();
    const el = document.querySelector("audio")!;
    const plays = play.mock.calls.length;
    const pause = HTMLMediaElement.prototype.pause as ReturnType<typeof vi.fn>;

    await user.click(screen.getByRole("radio", { name: "選択肢1" }));
    await user.click(screen.getByRole("button", { name: "答题卡" }));
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "下一大题" }));
    await screen.findByRole("radio", { name: "選択肢2" });
    expect(document.querySelector("audio")).toBe(el);            // same instance
    expect(pause).not.toHaveBeenCalled();
    expect(play.mock.calls.length).toBe(plays);                  // never restarted
  });

  it("after a refresh mid-listening: no confirm page, the pill offers only to continue", async () => {
    renderListeningExam({ phaseAudio: { ...PA, state: "playing", position_ms: 60000 }, units: 1 });
    expect(await screen.findByRole("radio", { name: "選択肢1" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "确认开始听力考试" })).toBeNull();
    expect(screen.getByRole("button", { name: "继续播放" })).toBeInTheDocument();
  });

  it("speed cannot be changed: any rate change snaps back to 1×", () => {
    render(<StrictAudioPlayer variant="exam-mini" sessionId="m-1" sessionUnitId=""
      materialId="full-1" src="/full.mp3" status={{ ...st("playing", 1000), material_id: "full-1" }}
      onStatus={() => {}} start={async () => ({ material_id: "full-1", state: "playing",
        position_ms: 1000, duration_ms: 2400000 })} />);
    const el = document.querySelector("audio")!;
    el.playbackRate = 2;
    el.dispatchEvent(new Event("ratechange"));
    expect(el.playbackRate).toBe(1);
  });

  it("a server refusal stops the sound and says so", async () => {
    const user = userEvent.setup();
    render(<StrictAudioPlayer variant="exam-mini" sessionId="m-1" sessionUnitId=""
      materialId="full-1" src="/full.mp3" status={{ ...st("idle"), material_id: "full-1" }}
      onStatus={() => {}} start={async () => {
        throw new ApiError(409, "phase_not_active", "本阶段已结束"); }} />);
    await user.click(screen.getByRole("button", { name: "开始播放" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("本阶段已结束");
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  });

  it("a stray pause resumes; if the system refuses, it is said plainly with 继续播放", async () => {
    render(<StrictAudioPlayer variant="exam-mini" sessionId="m-1" sessionUnitId=""
      materialId="full-1" src="/full.mp3" status={{ ...st("idle"), material_id: "full-1" }}
      onStatus={() => {}}
      start={async () => ({ material_id: "full-1", state: "playing", position_ms: 0,
                            duration_ms: 2400000 })} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "开始播放" }));
    await screen.findByRole("button", { name: "播放中，不可暂停" });
    play.mockRejectedValueOnce(new Error("NotAllowedError"));
    document.querySelector("audio")!.dispatchEvent(new Event("pause"));
    expect(await screen.findByRole("alert")).toHaveTextContent("音频被系统中断");
    expect(screen.getByRole("button", { name: "继续播放" })).toBeInTheDocument();
  });
});
