import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { DraftsList } from "../../api/dto/practice";
import type { MockContent, MockPhaseState, MockState } from "../../api/dto/mock";
import { ApiError } from "../../api/errors";
import { getMockDrafts, saveMockDraft, submitMockPhase } from "../../api/endpoints/mock";
import { Button } from "../../components/Button";
import { MaterialDisplay } from "../content/MaterialDisplay";
import { RichText } from "../content/richtext/RichText";
import { SharedMaterialLayout } from "../content/SharedMaterialLayout";
import type { VmContentUnit } from "../content/viewModel";
import { useDraftManager } from "../practice/useDraftManager";
import { DraftConflictDialog } from "../practice/SubmitDialogs";
import { clearSessionPendingRetries, loadPendingRetries } from "../practice/pendingRetries";
import { AnswerSheetDrawer } from "./AnswerSheetDrawer";
import { ExamSubmitDialog } from "./ExamSubmitDialog";
import { ExamTopBar } from "./ExamTopBar";
import { StrictAudioPlayer, type LiveAudio } from "./StrictAudioPlayer";
import { buildGroups, loadFlags, loadGroupIndex, saveFlags, saveGroupIndex,
         type ExamUnit } from "./mockModel";

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
  const [flags, setFlags] = useState(() => loadFlags(sessionId));
  const [current, setCurrent] = useState<string | null>(group?.questions[0]?.qid ?? null);
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

  const toggleFlag = useCallback((qid: string) => {
    setFlags((prev) => {
      const next = new Set(prev);
      if (next.has(qid)) next.delete(qid); else next.add(qid);
      saveFlags(sessionId, next);
      return next;
    });
  }, [sessionId]);

  const goGroup = (i: number) => {
    const n = Math.max(0, Math.min(groups.length - 1, i));
    setGroupIdx(n);
    saveGroupIndex(sessionId, phase.phase_id, n);
    setCurrent(groups[n]?.questions[0]?.qid ?? null);
    window.scrollTo?.({ top: 0 });
  };

  // Answer sheet jump: only questions of THIS phase exist here, so the phase
  // boundary can't be crossed. Closes the sheet; the page behind never moved.
  const jumpTo = useCallback((qid: string) => {
    const gi = groupOfQuestion.get(qid);
    if (gi === undefined) return;
    setGroupIdx(gi);
    saveGroupIndex(sessionId, phase.phase_id, gi);
    setCurrent(qid);
    setFocusReq((r) => ({ id: qid, n: (r?.n ?? 0) + 1 }));
    setSheetOpen(false);
  }, [groupOfQuestion, phase.phase_id, sessionId]);

  useEffect(() => {
    if (!focusReq) return;
    let id2 = 0;
    const id1 = requestAnimationFrame(() => { id2 = requestAnimationFrame(() => {
      const root = document.querySelector(".exam-main");
      const el = root?.querySelector<HTMLElement>(
        `[data-question-id="${CSS.escape(focusReq.id)}"]`);
      const target = el && el.offsetParent !== null ? el
        : el?.closest<HTMLElement>(".exam-unit") ?? null;
      target?.scrollIntoView?.({ block: "start", behavior: "smooth" });
    }); });
    return () => { cancelAnimationFrame(id1); cancelAnimationFrame(id2); };
  }, [focusReq]);

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

  return (
    <div className="exam-shell">
      <ExamTopBar examName={`${state.level} 模拟考试`} examTitle={state.exam_title}
                  where={`${phase.title} · ${group.label}`}
                  answered={answeredN} total={flat.length} remaining={remaining}
                  saveProblem={saveProblem} onOpenSheet={() => setSheetOpen(true)} />
      <main className="exam-main container">
        <div className="exam-group-head">
          <h1>{group.label}</h1>
          <span className="subject-chip" data-subject={group.subject}>
            {SUBJECT_LABEL[group.subject] ?? group.subject}
          </span>
          <span className="text-aux">
            第 {groupIdx + 1} / {groups.length} 大题 · {group.questions.length} 题
          </span>
        </div>

        {group.units.map((u) => (
          <UnitBlock key={u.sessionUnitId} unit={u} noOf={noOf}
                     manager={manager} flags={flags} onFlag={toggleFlag}
                     onCurrent={setCurrent} current={current}
                     focusRequest={focusReq} sessionId={sessionId}
                     audioLive={audioLive} onAudio={onAudio} />
        ))}

        {submitError ? <p role="alert">{submitError}</p> : null}
        <nav className="exam-bottom-nav" aria-label="大题导航">
          <Button variant="secondary" disabled={groupIdx === 0}
                  onClick={() => goGroup(groupIdx - 1)}>上一大题</Button>
          {isLastGroup ? (
            <Button variant="primary" onClick={openConfirm}>{actionLabel}</Button>
          ) : (
            <Button variant="primary" onClick={() => goGroup(groupIdx + 1)}>下一大题</Button>
          )}
        </nav>
      </main>

      <AnswerSheetDrawer open={sheetOpen} onClose={() => setSheetOpen(false)}
                         groups={groups} currentGroupIdx={groupIdx}
                         currentQid={current} isAnswered={isAnswered} flags={flags}
                         onJump={jumpTo} actionLabel={actionLabel}
                         onAction={openConfirm} phaseTitle={phase.title} />

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
  focusRequest, sessionId, audioLive, onAudio }: {
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
              className={`question-card card exam-question${current === question.id ? " is-current" : ""}`}
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
              <div role="radiogroup" aria-label={`第 ${no} 题选项`} className="exam-options">
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
        <SharedMaterialLayout content={vm} focusRequest={focusRequest}
          numberOf={(q) => noOf.get(q.id) ?? q.position}
          material={<MaterialDisplay unit={vm.unit} materials={vm.materials} />}
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
      {hasMaterial ? <MaterialDisplay unit={vm.unit} materials={vm.materials} /> : null}
      {list}
    </div>
  );
}
