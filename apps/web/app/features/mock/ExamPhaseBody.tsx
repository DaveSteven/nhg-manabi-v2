import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { DraftsList } from "../../api/dto/practice";
import type { MockContent, MockPhaseState, MockState } from "../../api/dto/mock";
import { ApiError } from "../../api/errors";
import { getMockDrafts, saveMockDraft, startMockPhaseAudio, submitMockPhase } from "../../api/endpoints/mock";
import { releaseAssetUrl } from "../../api/endpoints/exams";
import { Button } from "../../components/Button";
import { MaterialDisplay } from "../content/MaterialDisplay";
import { RichText } from "../content/richtext/RichText";
import { SharedMaterialLayout } from "../content/SharedMaterialLayout";
import type { VmContentUnit } from "../content/viewModel";
import { useDraftManager } from "../practice/useDraftManager";
import { DraftConflictDialog } from "../practice/SubmitDialogs";
import { clearSessionPendingRetries, loadPendingRetries } from "../practice/pendingRetries";
import { useNavigate } from "react-router";
import { AbandonExamDialog } from "./AbandonExamDialog";
import { AnswerSheetDrawer } from "./AnswerSheetDrawer";
import { ExamSubmitDialog } from "./ExamSubmitDialog";
import { ExamTopBar } from "./ExamTopBar";
import { StrictAudioPlayer, type LiveAudio, type StrictAudioControl } from "./StrictAudioPlayer";
import { ListeningConfirm } from "./ListeningConfirm";
import { buildGroups, loadFlags, loadGroupIndex, optionColumns, saveFlags,
         saveGroupIndex, loadUnitIndex, saveUnitIndex, type ExamUnit } from "./mockModel";

const SUBJECT_LABEL: Record<string, string> = {
  vocabulary: "文字词汇", grammar: "文法", reading: "读解", listening: "听力",
};

/**
 * One phase of the strict mock. The exam frame (status bar, answer sheet) is
 * the same for every question type; only the answer area adapts: short
 * questions run several to a screen, cloze/reading units use the existing
 * article + question-panel layout. Choosing an option only saves a draft —
 * nothing is judged or revealed here; the server judges at hand-in/expiry.
 */
export function ExamPhaseBody({ sessionId, state, phase, content, drafts,
  remaining, isLastPhase }: {
  sessionId: string;
  state: MockState;
  phase: MockPhaseState;
  content: MockContent;
  drafts: DraftsList["drafts"];
  remaining: number | null;
  isLastPhase: boolean;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [abandoning, setAbandoning] = useState(false);
  const groups = useMemo(() => buildGroups(content.units), [content.units]);
  const flat = useMemo(() => groups.flatMap((g) => g.questions), [groups]);
  const unitOf = useMemo(
    () => new Map(flat.map((q) => [q.qid, q.sessionUnitId])), [flat]);
  const groupOfQuestion = useMemo(() => {
    const m = new Map<string, number>();
    groups.forEach((g, gi) => g.questions.forEach((q) => m.set(q.qid, gi)));
    return m;
  }, [groups]);
  const noOf = useMemo(() => new Map(flat.map((q) => [q.qid, q.no])), [flat]);
  const unitIdxOfQuestion = useMemo(() => {
    const m = new Map<string, number>();
    groups.forEach((g) => g.units.forEach((u, ui) =>
      u.vm.questions.forEach((q) => m.set(q.id, ui))));
    return m;
  }, [groups]);

  const manager = useDraftManager(sessionId, flat[0]?.sessionUnitId ?? "", {
    persist: true, unitOf: (qid) => unitOf.get(qid), save: saveMockDraft,
  });

  // Refresh restore: server drafts first, then local retry records that are
  // newer than the server version (failed saves).
  const hydrated = useRef(false);
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    manager.registerQuestions(flat.map((f) => f.qid));
    const server = drafts.map((d) => ({
      questionId: d.question_id, optionId: d.chosen_option_id,
      rowVersion: d.row_version }));
    manager.hydrate(server);
    for (const retry of loadPendingRetries(sessionId)) {
      const s = server.find((d) => d.questionId === retry.questionId);
      if (retry.knownVersion > (s ? s.rowVersion : 0)) {
        manager.select(retry.questionId, retry.optionId ?? "");
      } else {
        clearSessionPendingRetries(sessionId);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  void manager.state; // re-render on draft changes (displayValue reads a ref)
  const isAnswered = (qid: string) => {
    const v = manager.displayValue(qid);
    return v !== null && v !== "";
  };
  const answeredN = flat.filter((q) => isAnswered(q.qid)).length;
  const saveProblem = Object.values(manager.state.questions)
    .some((q) => q.status === "save_error");

  const [groupIdx, setGroupIdx] = useState(() =>
    Math.min(loadGroupIndex(sessionId, phase.phase_id), Math.max(groups.length - 1, 0)));
  const group = groups[groupIdx];
  // ADR-0023: in a shared-material 大題 only one material (Unit) is on the page
  const [unitIdx, setUnitIdx] = useState(() => {
    const g = groups[Math.min(loadGroupIndex(sessionId, phase.phase_id), Math.max(groups.length - 1, 0))];
    return g?.paged ? Math.min(loadUnitIndex(sessionId, phase.phase_id), g.units.length - 1) : 0;
  });
  const lastActive = useRef(new Map<string, string>());
  const [flags, setFlags] = useState(() => loadFlags(sessionId));
  const [current, setCurrent] = useState<string | null>(
    (group?.paged ? group.units[unitIdx]?.vm.questions[0]?.id : group?.questions[0]?.qid) ?? null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [focusReq, setFocusReq] = useState<{ id: string; n: number } | null>(null);
  // playback status per audio material, kept above the units so leaving and
  // re-entering a 大題 continues on the same server timeline
  const [audioLive, setAudioLive] = useState<Record<string, LiveAudio>>(() => {
    const now = Date.now();
    const m: Record<string, LiveAudio> = {};
    for (const g of groups) for (const u of g.units) {
      for (const a of Object.values(u.audio)) m[a.material_id] = { ...a, at: now };
    }
    return m;
  });
  const onAudio = useCallback((id: string, next: LiveAudio) =>
    setAudioLive((prev) => ({ ...prev, [id]: next })), []);

  // Continuous listening (ADR-0022): ONE player for the whole phase, mounted
  // above the 大題 pages so switching 大題 / opening the sheet never touches it.
  const phaseAudio = content.phase_audio ?? null;
  const [phaseLive, setPhaseLive] = useState<LiveAudio | null>(() => phaseAudio
    ? { material_id: phaseAudio.asset_id, state: phaseAudio.state,
        position_ms: phaseAudio.position_ms, duration_ms: phaseAudio.duration_ms,
        at: Date.now() }
    : null);
  // Listening confirm page (ADR-0022): shown while the phase recording has
  // not started; confirming starts it inside the click and opens the page.
  const playerCtl = useRef<StrictAudioControl>(null);
  const [confirmed, setConfirmed] = useState(false);
  const needsConfirm = !!phaseAudio && phaseAudio.state === "idle" && !confirmed;
  const confirmStart = () => {
    setConfirmed(true);
    void playerCtl.current?.begin();
    window.scrollTo?.({ top: 0 });
  };
  const onPhaseAudio = useCallback((_: string, next: LiveAudio) => setPhaseLive(next), []);
  const startPhaseAudio = useCallback(async () => {
    const s = await startMockPhaseAudio(sessionId, phase.phase_id);
    // the server clock starts now (ADR-0024): re-read the phase's new expiry
    void queryClient.invalidateQueries({ queryKey: ["mock", "state", sessionId] });
    return { material_id: s.asset_id, state: s.state, position_ms: s.position_ms,
             duration_ms: s.duration_ms };
  }, [sessionId, phase.phase_id, queryClient]);

  const toggleFlag = useCallback((qid: string) => {
    setFlags((prev) => {
      const next = new Set(prev);
      if (next.has(qid)) next.delete(qid); else next.add(qid);
      saveFlags(sessionId, next);
      return next;
    });
  }, [sessionId]);

  const showUnit = (gi: number, ui: number, qid?: string) => {
    const g = groups[gi];
    setGroupIdx(gi);
    setUnitIdx(ui);
    saveGroupIndex(sessionId, phase.phase_id, gi);
    saveUnitIndex(sessionId, phase.phase_id, ui);
    const u = g?.units[ui];
    setCurrent(qid ?? (g?.paged
      ? lastActive.current.get(u?.sessionUnitId ?? "") ?? u?.vm.questions[0]?.id
      : g?.questions[0]?.qid) ?? null);
    setFocusReq(null);
  };
  const goGroup = (i: number, toEnd = false) => {
    const n = Math.max(0, Math.min(groups.length - 1, i));
    showUnit(n, toEnd && groups[n]?.paged ? groups[n]!.units.length - 1 : 0);
    window.scrollTo?.({ top: 0 });
  };
  const goUnit = (delta: number) => {
    const n = Math.max(0, Math.min(group!.units.length - 1, unitIdx + delta));
    showUnit(groupIdx, n);
    window.scrollTo?.({ top: 0 });
  };
  const onCurrent = useCallback((qid: string) => {
    const u = unitOf.get(qid);
    if (u) lastActive.current.set(u, qid);
    setCurrent(qid);
  }, [unitOf]);

  // Answer sheet jump: only questions of THIS phase exist here, so the phase
  // boundary can't be crossed. Closes the sheet; the page behind never moved.
  const jumpTo = useCallback((qid: string) => {
    const gi = groupOfQuestion.get(qid);
    if (gi === undefined) return;
    showUnit(gi, groups[gi]?.paged ? unitIdxOfQuestion.get(qid) ?? 0 : 0, qid);
    pinnedUntil.current = Date.now() + 900;
    setFocusReq((r) => ({ id: qid, n: (r?.n ?? 0) + 1 }));
    setSheetOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupOfQuestion, groups, unitIdxOfQuestion, phase.phase_id, sessionId]);

  useEffect(() => {
    if (!focusReq) return;
    let id2 = 0;
    const id1 = requestAnimationFrame(() => { id2 = requestAnimationFrame(() => {
      const root = document.querySelector(".exam-main");
      const el = root?.querySelector<HTMLElement>(
        `[data-question-id="${CSS.escape(focusReq.id)}"]`);
      // a question in the sticky side panel: bring its unit (material start
      // + panel) into view rather than the sticky card itself
      const inStickyPanel = !!el?.closest(".reading-question-panel")
        && window.innerWidth >= 1024;
      const target = el && el.offsetParent !== null && !inStickyPanel ? el
        : el?.closest<HTMLElement>(".exam-unit") ?? null;
      target?.scrollIntoView?.({ block: "start", behavior: "smooth" });
    }); });
    return () => { cancelAnimationFrame(id1); cancelAnimationFrame(id2); };
  }, [focusReq]);

  // The "current" question follows what the user is actually looking at: the
  // first visible card whose top has passed under the exam bar. A jump from
  // the sheet pins it for a moment so the smooth scroll cannot flip it back.
  const pinnedUntil = useRef(0);
  useEffect(() => {
    let raf = 0;
    const spy = () => {
      raf = 0;
      if (Date.now() < pinnedUntil.current) return;
      const root = document.querySelector(".exam-main");
      if (!root) return;
      const barH = (document.querySelector(".exam-bar-wrap") as HTMLElement | null)
        ?.getBoundingClientRect().bottom ?? 80;
      let pick: string | null = null;
      for (const el of root.querySelectorAll<HTMLElement>(".exam-question")) {
        if (el.offsetParent === null) continue;          // hidden panel questions
        // sticky side panel: the question being worked on is the active one
        if (el.closest(".reading-question-panel") && !el.classList.contains("is-active-question")) continue;
        const r = el.getBoundingClientRect();
        if (r.bottom > barH + 24) { pick = el.dataset.questionId ?? null; break; }
      }
      if (pick) setCurrent((c) => (c === pick ? c : pick));
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(spy); };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); if (raf) cancelAnimationFrame(raf); };
  }, [groupIdx, unitIdx]);

  const submit = useMutation<MockState, ApiError, void>({
    mutationFn: () => submitMockPhase(sessionId, phase.phase_id, flat.map((q) => ({
      session_unit_id: q.sessionUnitId, question_id: q.qid,
      chosen_option_id: manager.displayValue(q.qid) || null,
    }))),
    onSuccess: (next) => {
      clearSessionPendingRetries(sessionId);
      setConfirming(false);
      queryClient.setQueryData(["mock", "state", sessionId], next);
      void queryClient.invalidateQueries({ queryKey: ["mock", "current"] });
    },
    onError: (error) => {
      setConfirming(false);
      if (error.status === 409 || error.status === 404) {
        // the phase was already sealed (time ran out): re-read the server
        void queryClient.invalidateQueries({ queryKey: ["mock", "state", sessionId] });
      }
      setSubmitError(`提交失败：${error.message}。你的答案仍保留，可重试。`);
    },
  });

  const resolveConflict = useCallback(async (qid: string, mode: "adopt" | "overwrite") => {
    const list = await getMockDrafts(sessionId);
    const row = list.drafts.find((d) => d.question_id === qid);
    if (mode === "adopt") manager.adoptServer(qid, row?.chosen_option_id ?? null, row?.row_version ?? 0);
    else manager.overwriteAfterConflict(qid, row?.row_version ?? 0);
  }, [manager, sessionId]);

  if (!group) return <p role="status">本阶段没有可作答的题目。</p>;

  const actionLabel = isLastPhase ? "检查并交卷" : "结束当前阶段";
  const openConfirm = () => { setSubmitError(null); setSheetOpen(false); setConfirming(true); };
  const isLastGroup = groupIdx === groups.length - 1;
  const paged = group.paged;
  const lastUnit = unitIdx >= group.units.length - 1;
  const shownUnits = paged ? group.units.slice(unitIdx, unitIdx + 1) : group.units;

  return (
    <div className={`exam-shell${phaseAudio && phaseLive ? " has-listen-mini" : ""}`}>
      <ExamTopBar examName={`${state.level} 模拟考试`} examTitle={state.exam_title}
                  where={`${phase.title} · ${group.label}`}
                  answered={answeredN} total={flat.length}
                  remaining={needsConfirm ? phase.duration_seconds : remaining}
                  saveProblem={saveProblem} onOpenSheet={() => setSheetOpen(true)} />
      {phaseAudio && phaseLive ? (
        // ONE player for the phase, mounted even under the confirm page so
        // the confirm click can start it; fixed at the bottom of the screen
        <div className="exam-listen-mini" hidden={needsConfirm}>
          <StrictAudioPlayer variant="exam-mini" sessionId={sessionId}
            sessionUnitId="" materialId={phaseAudio.asset_id}
            src={releaseAssetUrl(state.release_id, phaseAudio.asset_id)}
            status={phaseLive} onStatus={onPhaseAudio} start={startPhaseAudio}
            controlRef={playerCtl} />
        </div>
      ) : null}
      {needsConfirm && phaseAudio ? (
        <ListeningConfirm title={phase.title} remaining={remaining}
                          audioMs={phaseAudio.duration_ms} questions={flat.length}
                          onConfirm={confirmStart} />
      ) : (<>
      <main className="exam-main container">
        <div className="exam-group-head">
          <h1>{group.label}</h1>
          <span className="subject-chip" data-subject={group.subject}>
            {SUBJECT_LABEL[group.subject] ?? group.subject}
          </span>
          <span className="text-aux">
            第 {groupIdx + 1} / {groups.length} 大题 · {group.questions.length} 题
            {paged ? ` · 第 ${unitIdx + 1} / ${group.units.length} 篇` : ""}
          </span>
        </div>

        {shownUnits.map((u) => (
          <UnitBlock key={u.sessionUnitId} unit={u} noOf={noOf}
                     onNextMaterial={paged && !lastUnit ? () => goUnit(1) : undefined}
                     manager={manager} flags={flags} onFlag={toggleFlag}
                     onCurrent={onCurrent} current={current}
                     focusRequest={focusReq} sessionId={sessionId}
                     audioLive={audioLive} onAudio={onAudio} />
        ))}

        {submitError ? <p role="alert">{submitError}</p> : null}
        <nav className="exam-bottom-nav" aria-label="大题导航">
          {paged && unitIdx > 0 ? (
            <Button variant="secondary" onClick={() => goUnit(-1)}>上一篇</Button>
          ) : (
            <Button variant="secondary" disabled={groupIdx === 0}
                    onClick={() => goGroup(groupIdx - 1, true)}>上一大题</Button>
          )}
          {paged && !lastUnit ? (
            <Button variant="primary" onClick={() => goUnit(1)}>下一篇</Button>
          ) : isLastGroup ? (
            <Button variant="primary" onClick={openConfirm}>{actionLabel}</Button>
          ) : (
            <Button variant="primary" onClick={() => goGroup(groupIdx + 1)}>下一大题</Button>
          )}
        </nav>
      </main>
      </>)}

      <AnswerSheetDrawer open={sheetOpen} onClose={() => setSheetOpen(false)}
                         groups={groups}
                         currentGroupIdx={(current && groupOfQuestion.get(current)) || groupIdx}
                         currentQid={current} isAnswered={isAnswered} flags={flags}
                         onJump={jumpTo} actionLabel={actionLabel}
                         onAction={openConfirm}
                         onAbandon={() => { setSheetOpen(false); setAbandoning(true); }}
                         phaseTitle={phase.title} />

      {abandoning ? (
        <AbandonExamDialog sessionId={sessionId} onCancel={() => setAbandoning(false)}
          onDone={() => navigate(`/study/exams/${encodeURIComponent(state.exam_id)}`, { replace: true })} />
      ) : null}
      {confirming ? (
        <ExamSubmitDialog final={isLastPhase} answered={answeredN}
                          unanswered={flat.length - answeredN}
                          flagged={flat.filter((q) => flags.has(q.qid)).length}
                          submitting={submit.isPending}
                          onConfirm={() => submit.mutate()}
                          onCancel={() => setConfirming(false)} />
      ) : null}
      {manager.conflicts.map((c) => (
        <DraftConflictDialog key={c.questionId} questionId={c.questionId}
          onAdoptServer={() => resolveConflict(c.questionId, "adopt")}
          onOverwrite={() => resolveConflict(c.questionId, "overwrite")} />
      ))}
    </div>
  );
}

function UnitBlock({ unit, noOf, manager, flags, onFlag, onCurrent, current,
  focusRequest, sessionId, audioLive, onAudio, onNextMaterial }: {
  onNextMaterial?: () => void;
  sessionId: string;
  audioLive: Record<string, LiveAudio>;
  onAudio(id: string, next: LiveAudio): void;
  unit: ExamUnit;
  noOf: Map<string, string>;
  manager: ReturnType<typeof useDraftManager>;
  flags: Set<string>;
  onFlag(qid: string): void;
  onCurrent(qid: string): void;
  current: string | null;
  focusRequest: { id: string; n: number } | null;
}) {
  const vm: VmContentUnit = unit.vm;
  const list = (
    <ol className="question-list">
      {vm.questions.map((question) => {
        const qState = manager.state.questions[question.id];
        const selected = qState ? (qState.pendingOptionId ?? qState.optionId) : null;
        const no = noOf.get(question.id) ?? String(question.position);
        const flagged = flags.has(question.id);
        return (
          <li key={question.id} data-question-id={question.id}
              className="question-card card exam-question"
              onFocusCapture={() => onCurrent(question.id)}
              onClickCapture={() => onCurrent(question.id)}>
            <fieldset className="question-fieldset">
              <legend>
                第 {no} 题
                {qState?.status === "save_error" ? (
                  <span className="save-state save-save_error" aria-live="polite">
                    保存失败，将自动重试
                  </span>
                ) : null}
              </legend>
              {question.prompt !== null ? (
                <div lang="ja">
                  <RichText value={question.prompt} slotIds={vm.unit.slotIds} />
                </div>
              ) : null}
              <div role="radiogroup" aria-label={`第 ${no} 题选项`}
                   className={`exam-options${optionColumns(question.options, unit.split) === 2 ? " is-grid" : ""}`}>
                {question.options.map((o) => (
                  <label key={o.id} lang="ja"
                         className={`option-row${selected === o.id ? " option-selected" : ""}`}>
                    <input type="radio" name={`q-${question.id}`} value={o.id}
                           checked={selected === o.id}
                           onChange={() => manager.select(question.id, o.id)} />
                    <RichText value={o.content} slotIds={vm.unit.slotIds} />
                  </label>
                ))}
              </div>
            </fieldset>
            <button type="button" className={`exam-flag${flagged ? " is-on" : ""}`}
                    aria-pressed={flagged}
                    onClick={() => onFlag(question.id)}>
              <span aria-hidden="true">⚑</span> {flagged ? "已标记待检查" : "标记待检查"}
            </button>
          </li>
        );
      })}
    </ol>
  );
  const audioNote = unit.hasAudio ? (
    <>
      {vm.materials.filter((m) => m.kind === "audio").map((m) => {
        const st = audioLive[m.id];
        return st ? (
          <StrictAudioPlayer key={m.id} sessionId={sessionId}
            sessionUnitId={unit.sessionUnitId} materialId={m.id}
            src={m.audio?.kind === "url" ? m.audio.url : null}
            status={st} onStatus={onAudio} />
        ) : null;
      })}
    </>
  ) : null;

  if (unit.split) {
    return (
      <div className="exam-unit" data-unit-id={vm.unit.id}>
        {audioNote}
        <SharedMaterialLayout content={vm} focusRequest={focusRequest} adaptive
          numberOf={(q) => noOf.get(q.id) ?? q.position}
          initialActive={current} onNextMaterial={onNextMaterial}
          onActiveChange={onCurrent}
          material={<MaterialDisplay unit={vm.unit} materials={vm.materials} imageZoom />}
          footer={null}>
          {list}
        </SharedMaterialLayout>
      </div>
    );
  }
  const hasMaterial = vm.materials.some((m) => m.kind !== "audio");
  return (
    <div className="exam-unit" data-unit-id={vm.unit.id}>
      {audioNote}
      {hasMaterial ? <MaterialDisplay unit={vm.unit} materials={vm.materials} imageZoom /> : null}
      {list}
    </div>
  );
}
