import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { getExamUnit } from "../api/endpoints/exams";
import { toViewModel } from "../features/content/toViewModel";
import { MaterialDisplay } from "../features/content/MaterialDisplay";
import { RichText } from "../features/content/richtext/RichText";
import { AudioPlayer } from "../features/content/AudioPlayer";

/**
 * DEV-ONLY automated audio smoke probe: loads the real media endpoint in
 * a genuine browser Audio element, waits for metadata, seeks, and reports
 * whether seek/timeupdate events fire. Results render into the DOM so a
 * headless dump can capture them. Records nothing in production paths.
 */
function useAudioSmokeProbe(url: string | null) {
  const [lines, setLines] = useState<string[]>([]);
  useEffect(() => {
    if (!url) return;
    const log = (m: string) => setLines((l) => [...l, m]);
    const audio = new Audio(url);
    const timer = setTimeout(() => log("RESULT: timeout (no loadedmetadata in 10s)"),
      10_000);
    audio.addEventListener("loadedmetadata", () => {
      clearTimeout(timer);
      log(`RESULT: loadedmetadata duration=${audio.duration.toFixed(2)}s`);
      audio.currentTime = Math.min(5, audio.duration / 2);
    });
    audio.addEventListener("seeking", () => log("seeking fired"));
    audio.addEventListener("seeked", () => {
      log(`RESULT: seeked currentTime=${audio.currentTime.toFixed(2)}s`);
      audio.play().then(() => log("RESULT: play() accepted")).catch((e) =>
        log(`RESULT: play() rejected: ${String(e)}`));
    });
    audio.addEventListener("timeupdate", () => {
      if (audio.currentTime > 0.2) {
        log("RESULT: timeupdate with advancing currentTime — playback OK");
        audio.pause();
        audio.src = ""; // stop
      }
    });
    audio.addEventListener("error", () => log("RESULT: audio error event"));
    audio.load();
    return () => {
      clearTimeout(timer);
      audio.pause();
      audio.src = "";
    };
  }, [url]);
  return lines;
}

/**
 * DEV-ONLY render harness (VITE_DEV_TOOLS=1). Not linked from nav and
 * disabled unless the env flag is set at build/dev time. Renders a real
 * staged/published unit through the full Canonical pipeline for visual
 * walkthroughs (M2.3 E2E fixture mount point).
 */
export default function DevUnitHarness() {
  const enabled = import.meta.env.VITE_DEV_TOOLS === "1";
  const { unitId } = useParams<{ unitId: string }>();
  const [params] = useSearchParams();
  const examId = params.get("examId") ?? "";
  const [diag, setDiag] = useState<string[]>([]);

  const unit = useQuery({
    queryKey: ["dev-unit", examId, unitId],
    queryFn: ({ signal }) => getExamUnit(examId, unitId!, signal),
    enabled: enabled && examId !== "" && unitId !== undefined,
  });

  // Hooks must run unconditionally (before any early return).
  let audioUrl: string | null = null;
  if (unit.data) {
    const vmProbe = toViewModel(unit.data);
    const audio = vmProbe.materials.find((m) => m.audio?.kind === "url")?.audio;
    if (audio && audio.kind === "url") audioUrl = audio.url;
  }
  const smoke = useAudioSmokeProbe(
    audioUrl ? `${window.location.origin}${audioUrl}` : null);

  if (!enabled) {
    return <p role="status">开发工具未启用（VITE_DEV_TOOLS）。</p>;
  }
  if (unit.isPending) return <p role="status">加载中…</p>;
  if (unit.error !== null) {
    return <p role="alert">Unit 加载失败：{unit.error.message}</p>;
  }

  const vm = toViewModel(unit.data!);

  return (
    <div className="practice-shell">
      <main className="container">
        <h1>DEV 渲染管线：{vm.unit.label ?? vm.unit.id}</h1>
        <p className="text-aux">slots: {vm.unit.slotIds.join(", ") || "—"}</p>
        <MaterialDisplay unit={vm.unit} materials={vm.materials}
                         onDiagnostic={(r) => setDiag((d) => [...d, r])} />
        <ol className="question-list">
          {vm.questions.map((q) => (
            <li key={q.id} className="question-card card">
              <h2>{q.printedNumber ?? q.id}</h2>
              {q.prompt !== null ? (
                <RichText value={q.prompt} slotIds={vm.unit.slotIds}
                          onDiagnostic={(r) => setDiag((d) => [...d, r])} />
              ) : null}
              <ul className="option-list">
                {q.options.map((o) => (
                  <li key={o.id} className="option-row">
                    <RichText value={o.content} slotIds={vm.unit.slotIds}
                              onDiagnostic={(r) => setDiag((d) => [...d, r])} />
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
        {diag.length > 0 ? (
          <pre className="dev-diagnostics" data-testid="dev-diagnostics">
            {diag.join("\n")}
          </pre>
        ) : null}
        {audioUrl ? (
          <pre data-testid="audio-smoke-probe"
               style={{ background: "#eee", padding: 12 }}>
            {smoke.length > 0 ? smoke.join("\n") : "audio probe: waiting…"}
          </pre>
        ) : null}
      </main>
      {audioUrl ? <AudioPlayer src={audioUrl} /> : null}
    </div>
  );
}
