import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import type { FeedbackPayload } from "../../api/dto/practice";
import { getDrafts } from "../../api/endpoints/sessions";
import { toViewModel } from "../content/toViewModel";
import { MaterialDisplay } from "../content/MaterialDisplay";
import { RichText } from "../content/richtext/RichText";
import { AudioDock } from "../content/AudioDock/AudioDock";
import { useSessionRestore, type RestoredUnit } from "./useSessionRestore";
import { useDraftManager } from "./useDraftManager";
import { useSubmitUnit } from "./useSubmitUnit";
import { useFeedback } from "./useFeedback";
import { useFinishSession } from "./useStartPractice";
import { PracticeBreadcrumb } from "./PracticeBreadcrumb";
import { DraftConflictDialog, UnansweredConfirmDialog } from "./SubmitDialogs";
import { clearSessionPendingRetries, loadPendingRetries } from "./pendingRetries";

const STATUS_TEXT: Record<string, string> = {
  idle: "",
  dirty: "编辑中…",
  saving: "保存中…",
  saved: "已保存",
  save_error: "保存失败，可重试",
  conflict: "版本冲突",
};

/**
 * Practice page: material + questions + drafts + submit + feedback.
 * Refresh-restore order: server session → fixed-release units → server
 * drafts → merge local pending retries (only when newer by version).
 */
export function PracticePage({ sessionId }: { sessionId: string }) {
  const navigate = useNavigate();
  const bundle = useSessionRestore(sessionId);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [submitMsg, setSubmitMsg] = useState<string | null>(null);
  const [finishError, setFinishError] = useState<string | null>(null);

  const session = bundle.data?.session;
  const units = bundle.data?.units ?? [];
  const current: RestoredUnit | undefined = units[currentIdx];
  const sessionUnit = session?.units.find((u) => u.id === current?.sessionUnitId);
  const unitSubmitted = sessionUnit?.state === "submitted";
  const sessionEnded = session !== undefined && session.state !== "in_progress";

  const content = useMemo(
    () => (current ? toViewModel(current.unit) : null),
    [current],
  );
  const questionIds = useMemo(
    () => content?.questions.map((q) => q.id) ?? [],
    [content],
  );

  const manager = useDraftManager(sessionId, current?.sessionUnitId ?? "");
  const submit = useSubmitUnit(sessionId, (outcome) => {
    setConfirming(false);
    if (outcome.kind === "submitted") {
      manager.markSubmitted(questionIds);
      setSubmitMsg(outcome.result.idempotent
        ? "本组已提交（重复请求返回同一结果）"
        : `已提交：答 ${outcome.result.answered_count} 题，未答 ${outcome.result.skipped_count} 题`);
    } else if (outcome.kind === "alreadySubmitted") {
      manager.markSubmitted(questionIds);
      setSubmitMsg("提交结果已确认（此前已提交成功）");
    } else {
      setSubmitMsg(`提交失败：${outcome.error.message}`);
    }
  });
  const finish = useFinishSession();
  useEffect(() => {
    manager.registerQuestions(questionIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questionIds.join("|")]);

  // Hydrate server drafts once per unit + merge local pending retries.
  useEffect(() => {
    if (!bundle.data || !current) return;
    const server = bundle.data.drafts
      .filter((d) => d.session_unit_id === current.sessionUnitId)
      .map((d) => ({ questionId: d.question_id, optionId: d.chosen_option_id,
                     rowVersion: d.row_version }));
    manager.hydrate(server);
    if (unitSubmitted) manager.markSubmitted(questionIds);
    for (const retry of loadPendingRetries(sessionId)) {
      const s = server.find((d) => d.questionId === retry.questionId);
      const local = s ? s.rowVersion : 0;
      if (retry.knownVersion > local) {
        manager.select(retry.questionId, retry.optionId ?? "");
      } else {
        clearSessionPendingRetries(sessionId);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle.data, current?.sessionUnitId, unitSubmitted]);

  const feedback = useFeedback(sessionId, current?.sessionUnitId ?? "",
    session?.feedback_mode ?? "immediate",
    { unitSubmitted, sessionEnded });

  const unanswered = useMemo(() => {
    if (!content) return 0;
    return content.questions.filter((q) => {
      const v = manager.displayValue(q.id);
      return v === null || v === "";
    }).length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, manager.state]);

  const audioMaterial = content?.materials.find((m) => m.audio?.kind === "url");
  const audioUrl = audioMaterial?.audio?.kind === "url" ? audioMaterial.audio.url : null;
  // Transcript reveal gate (audio-player.md §8) — mirrors the backend's
  // _feedback_gate: immediate → THIS unit submitted; end → session ended.
  // The backend remains the authority; this only drives the UI lock state.
  const transcriptAllowed = unitSubmitted
    && (session?.feedback_mode === "immediate" || sessionEnded);

  const onConfirmSubmit = useCallback(() => {
    if (!current) return;
    setSubmitMsg(null);
    submit.mutate({ sessionUnitId: current.sessionUnitId,
                    answers: manager.answers() });
  }, [current, manager, submit]);

  const onFinish = useCallback(() => {
    setFinishError(null);
    finish.mutate(sessionId, {
      onSuccess: (res) => {
        if (res.state === "completed") {
          clearSessionPendingRetries(sessionId);
          navigate(`/study/practice/${encodeURIComponent(sessionId)}/results`);
        } else {
          setFinishError(
            "仍有未提交的题目：练习已提前结束，已提交的答案保留，未生成完整成绩。");
        }
      },
      onError: (e) => setFinishError(`结束练习失败：${e.message}`),
    });
  }, [finish, navigate, sessionId]);

  const resolveConflict = useCallback(async (questionId: string, mode: "adopt" | "overwrite") => {
    const drafts = await getDrafts(sessionId);
    const row = drafts.drafts.find(
      (d) => d.session_unit_id === current?.sessionUnitId
          && d.question_id === questionId);
    if (mode === "adopt") {
      manager.adoptServer(questionId, row?.chosen_option_id ?? null,
        row?.row_version ?? 0);
    } else {
      manager.overwriteAfterConflict(questionId, row?.row_version ?? 0);
    }
  }, [current, manager, sessionId]);

  if (bundle.isPending) return <p role="status">恢复练习中…</p>;
  if (bundle.error !== null) {
    return bundle.error.status === 404
      ? <p role="status">练习不存在或不可访问。</p>
      : <p role="alert">练习恢复失败：{bundle.error.message}</p>;
  }
  if (!session || !current) return null;

  const allSubmitted = session.units.every((u) => u.state === "submitted");
  if (!content) return null;
  const vm = content.unit;
  const materials = content.materials;
  const questions = content.questions;

  return (
    <div className="practice-shell">
      <main className="container">
        <PracticeBreadcrumb current="练习"
                            examId={session.units[0]?.exam_id ?? null} />
        <header className="practice-header">
          <h1>
            练习 · {vm.label ?? `组 ${vm.position}`}
            {unitSubmitted ? <span className="unit-locked">（已提交锁定）</span> : null}
          </h1>
          <p className="text-aux">
            {session.feedback_mode === "immediate"
              ? "即时反馈：提交本组后即可查看解析"
              : "统一反馈：整卷结束后统一揭晓答案"}
            {" · "}第 {currentIdx + 1} / {units.length} 组
          </p>
        </header>

        {units.length > 1 ? (
          <nav aria-label="题目组导航" className="unit-nav">
            {units.map((u, i) => {
              const su = session.units.find((x) => x.id === u.sessionUnitId);
              return (
                <button key={u.sessionUnitId} type="button"
                        aria-current={i === currentIdx}
                        onClick={() => setCurrentIdx(i)}>
                  {i + 1}{su?.state === "submitted" ? " ✓" : ""}
                </button>
              );
            })}
          </nav>
        ) : null}

        <MaterialDisplay unit={vm} materials={materials} />

        <ol className="question-list">
          {questions.map((q) => {
            const qState = manager.state.questions[q.id];
            const selected = qState
              ? (qState.pendingOptionId ?? qState.optionId) : null;
            return (
              <li key={q.id} className="question-card card">
                <fieldset className="question-fieldset" disabled={unitSubmitted}>
                  <legend>
                    {q.printedNumber ?? `第 ${q.position} 题`}
                    {qState ? (
                      <span className={`save-state save-${qState.status}`}
                            aria-live="polite">
                        {STATUS_TEXT[qState.status]}
                      </span>
                    ) : null}
                  </legend>
                  {q.prompt !== null ? (
                    <RichText value={q.prompt} slotIds={vm.slotIds} />
                  ) : null}
                  <div role="radiogroup" aria-label={`第 ${q.printedNumber ?? q.position} 题选项`}>
                    {q.options.map((o) => (
                      <label key={o.id}
                             className={`option-row${selected === o.id ? " option-selected" : ""}`}>
                        <input type="radio" name={`q-${q.id}`} value={o.id}
                               checked={selected === o.id}
                               onChange={() => manager.select(q.id, o.id)} />
                        <RichText value={o.content} slotIds={vm.slotIds} />
                      </label>
                    ))}
                    <button type="button" className="option-clear"
                            disabled={unitSubmitted || selected === null}
                            onClick={() => manager.clear(q.id)}>
                      清除本题选择
                    </button>
                  </div>
                </fieldset>
                {feedback.data
                  ? <FeedbackView feedback={feedback.data} questionId={q.id} />
                  : null}
              </li>
            );
          })}
        </ol>

        {submitMsg ? <p role="status">{submitMsg}</p> : null}
        {finishError ? <p role="alert">{finishError}</p> : null}
        {feedback.error ? (
          <p role="alert">解析获取失败：{feedback.error.message}</p>
        ) : null}

        <div className="practice-actions">
          {!unitSubmitted ? (
            <button type="button" className="primary" disabled={submit.isPending}
                    onClick={() => setConfirming(true)}>
              提交本组
            </button>
          ) : null}
          {allSubmitted && !sessionEnded ? (
            <button type="button" className="primary" disabled={finish.isPending}
                    onClick={onFinish}>
              {session.feedback_mode === "end" ? "交卷并查看结果" : "完成练习"}
            </button>
          ) : null}
          {sessionEnded && !allSubmitted ? (
            <p className="text-aux">练习已提前结束（部分题目未提交）。</p>
          ) : null}
        </div>

        {confirming ? (
          <UnansweredConfirmDialog count={unanswered}
                                   submitting={submit.isPending}
                                   onConfirm={onConfirmSubmit}
                                   onCancel={() => setConfirming(false)} />
        ) : null}
        {manager.conflicts.map((c) => (
          <DraftConflictDialog key={c.questionId} questionId={c.questionId}
            onAdoptServer={() => resolveConflict(c.questionId, "adopt")}
            onOverwrite={() => resolveConflict(c.questionId, "overwrite")} />
        ))}
      </main>
      {audioUrl ? (
        <AudioDock src={audioUrl}
                   subtitle={`练习 · ${vm.label ?? `组 ${vm.position}`}`}
                   transcript={current
                     ? { sessionId, sessionUnitId: current.sessionUnitId,
                         allowed: transcriptAllowed }
                     : null} />
      ) : null}
    </div>
  );
}

function FeedbackView({ feedback, questionId }: {
  feedback: FeedbackPayload;
  questionId: string;
}) {
  const fq = feedback.questions.find((x) => x.question_id === questionId);
  if (!fq) return null;
  const verdict = fq.skipped || fq.is_correct === null
    ? { label: "未答", cls: "verdict-skipped" }
    : fq.is_correct
      ? { label: "正确", cls: "verdict-correct" }
      : { label: "错误", cls: "verdict-wrong" };
  return (
    <div className={`feedback ${verdict.cls}`} aria-live="polite">
      <p className="feedback-verdict">
        <span aria-hidden="true">
          {verdict.label === "正确" ? "✓" : verdict.label === "错误" ? "✗" : "—"}
        </span>{" "}
        {verdict.label}
      </p>
      {feedback.unit_explanations.map((e, i) => (
        <div key={i} className="feedback-explanation">
          <RichText value={e.content} />
        </div>
      ))}
      {fq.explanations.map((e, i) => (
        <div key={i} className="feedback-explanation">
          <RichText value={e.content} />
        </div>
      ))}
    </div>
  );
}
