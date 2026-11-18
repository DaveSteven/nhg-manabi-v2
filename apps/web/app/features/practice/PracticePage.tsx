import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { getDrafts } from "../../api/endpoints/sessions";
import { getExamOutline } from "../../api/endpoints/exams";
import { toViewModel } from "../content/toViewModel";
import { SharedMaterialLayout } from "../content/SharedMaterialLayout";
import { MaterialDisplay } from "../content/MaterialDisplay";
import { RichText } from "../content/richtext/RichText";
import { AudioDock } from "../content/AudioDock/AudioDock";
import { useSessionRestore, type RestoredUnit } from "./useSessionRestore";
import { useDraftManager } from "./useDraftManager";
import { answersForUnit } from "./draftMachine";
import { useSubmitUnit } from "./useSubmitUnit";
import { useFeedback } from "./useFeedback";
import { useFinishSession, useQuickPracticeStart } from "./useStartPractice";
import { outlineUnitLabel, quickPracticeCopy } from "./quickPracticeCopy";
import { PracticeBreadcrumb } from "./PracticeBreadcrumb";
import { FeedbackView } from "./FeedbackView";
import { UnifiedPracticeView } from "./UnifiedPractice";
import { DraftConflictDialog, UnansweredConfirmDialog } from "./SubmitDialogs";
import { clearSessionPendingRetries, restorePendingRetries } from "./pendingRetries";
import { Button, ButtonLink } from "../../components/Button";

const STATUS_TEXT: Record<string, string> = {
  save_error: "保存失败，可重试",
};

/**
 * Practice page: material + questions + drafts + submit + feedback.
 * Refresh-restore order: server session → fixed-release units → server
 * drafts → merge local pending retries (only when newer by version).
 *
 * Quick Practice sessions (`mode === "quick_practice"`, quick-practice.md
 * v2.0) deliberately bypass the draft/resume machinery: selections live in
 * pure React state (refresh/leave resets them), the session auto-completes
 * on submit, and post-submit navigation goes 下一组（同卷下一个 Unit，新
 * 会话）/ 返回试卷 instead of a per-session unit list.
 */
export function PracticePage({ sessionId }: { sessionId: string }) {
  const bundle = useSessionRestore(sessionId);
  const data = bundle.data;
  // 专项练习完成后结果与解析合并在 /results（ADR-0026）：旧练习地址跳转过去。
  if (data && data.session.mode === "practice"
      && data.session.config.topic !== undefined
      && data.session.state === "completed") {
    return <Navigate to={`/study/practice/${encodeURIComponent(sessionId)}/results`}
                     replace />;
  }
  // 统一反馈 practice sessions are a different interaction: drafts only while
  // navigating, one whole-session submit (UnifiedPractice.tsx). Everything
  // else — immediate practice and Quick Practice — keeps the per-unit flow.
  if (data && data.session.mode === "practice"
      && data.session.feedback_mode === "end") {
    return <UnifiedPracticeView sessionId={sessionId} bundle={data} />;
  }
  return <StepPracticePage sessionId={sessionId} />;
}

function StepPracticePage({ sessionId }: { sessionId: string }) {
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
  const isQuick = session?.mode === "quick_practice";
  const isTopic = session?.config.topic !== undefined;

  // Quick Practice copy derives from the Canonical unit kind + question
  // count (quick-practice.md v2.1 §6): 独立单题 提交/下一题,
  // 文法多题组 提交/下一组, 阅读文章 提交/下一篇. Multi-question
  // units list ALL their questions on one page under the shared material
  // (ADR-0017); the whole-unit submit transaction is untouched.

  const content = useMemo(
    () => (current ? toViewModel(current.unit) : null),
    [current],
  );
  const questionIds = useMemo(
    () => content?.questions.map((q) => q.id) ?? [],
    [content],
  );
  const quickCopy = useMemo(
    () => (isQuick && content
      ? quickPracticeCopy(content.unit.kind, content.questions.length)
      : null),
    [isQuick, content],
  );

  const manager = useDraftManager(sessionId, current?.sessionUnitId ?? "",
    { persist: !isQuick });
  const submit = useSubmitUnit(sessionId, (outcome) => {
    setConfirming(false);
    if (outcome.kind === "submitted") {
      manager.markSubmitted(questionIds);
      setSubmitMsg(null); // success needs no banner; the feedback card shows the result
    } else if (outcome.kind === "alreadySubmitted") {
      manager.markSubmitted(questionIds);
      setSubmitMsg(null);
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
  // Quick Practice skips both: no server drafts exist (selections are
  // local-only), and a revisit starts a fresh practice by design.
  useEffect(() => {
    if (!bundle.data || !current) return;
    if (isQuick) {
      if (unitSubmitted) manager.markSubmitted(questionIds);
      return;
    }
    const server = bundle.data.drafts
      .filter((d) => d.session_unit_id === current.sessionUnitId)
      .map((d) => ({ questionId: d.question_id, optionId: d.chosen_option_id,
                     rowVersion: d.row_version }));
    manager.hydrate(server);
    if (unitSubmitted) manager.markSubmitted(questionIds);
    restorePendingRetries(sessionId, server, manager, new Set(questionIds));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle.data, current?.sessionUnitId, unitSubmitted]);

  const feedback = useFeedback(sessionId, current?.sessionUnitId ?? "",
    session?.feedback_mode ?? "immediate",
    { unitSubmitted, sessionEnded });

  // Quick review: submitted choices come from the feedback payload (quick
  // sessions have no drafts) so the locked radios show what was actually
  // submitted after a refresh or revisit.
  useEffect(() => {
    if (!isQuick || !unitSubmitted || !feedback.data) return;
    manager.hydrate(feedback.data.questions.map((q) => ({
      questionId: q.question_id, optionId: q.chosen_option_id, rowVersion: 0,
    })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isQuick, unitSubmitted, feedback.data]);

  // Quick "下一组": the next unit of the SAME exam in outline order — a new
  // quick session, never a unit appended to this one. Null when the unit
  // is the exam's last (only 返回试卷 remains).
  const examId = session?.units[0]?.exam_id ?? null;
  const outline = useQuery({
    queryKey: ["exam-outline", examId],
    queryFn: ({ signal }) => getExamOutline(examId!, signal),
    enabled: isQuick && examId !== null,
    staleTime: 60_000,
  });
  const nextQuickUnit = useMemo(() => {
    if (!isQuick || !current || !outline.data) return null;
    const flat = outline.data.sections.flatMap(
      (s) => s.layers.flatMap((l) => l.units));
    const idx = flat.findIndex((u) => u.unit_id === current.unit.id);
    return idx >= 0 && idx + 1 < flat.length ? flat[idx + 1]! : null;
  }, [isQuick, current, outline.data]);
  // The unit's real position in the paper (問題1-3) for the page title —
  // same derivation as the exam outline rows, never a DB label.
  const quickTitle = useMemo(
    () => (isQuick && current && outline.data
      ? outlineUnitLabel(outline.data, current.unit.id)
      : null),
    [isQuick, current, outline.data],
  );
  const startQuick = useQuickPracticeStart((s) => {
    navigate(`/study/practice/${encodeURIComponent(s.id)}`);
  });

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
                    // The draft state survives navigation to the next unit's
                    // session (same component instance), so only send answers
                    // of THIS unit's questions — stale ids make the server
                    // reject the whole submit (question_not_in_unit).
                    answers: answersForUnit(manager.answers(), questionIds) });
  }, [current, manager, submit, questionIds]);

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
  const copy = quickCopy ?? { submitLabel: "提交", nextLabel: "下一组" };
  const title = isQuick
    ? (quickTitle ?? vm.label ?? "练习")
    : isTopic ? "专项练习" : `练习 · ${vm.label ?? `组 ${vm.position}`}`;

  return (
    <div className="practice-shell">
      <main className="container">
        <PracticeBreadcrumb current="练习" topic={isTopic}
                            examId={session.units[0]?.exam_id ?? null} />
        <header className="practice-header">
          <h1>
            {title}
            {!isQuick && unitSubmitted
              ? <span className="unit-locked">（已提交锁定）</span> : null}
          </h1>
          <p className="text-aux">
            {!isQuick ? `第 ${currentIdx + 1} / ${units.length} 题` : null}
          </p>
        </header>

        {units.length > 1 ? (
          <nav aria-label="题目导航"
               className={`unit-nav question-strip${units.length > 20 ? " is-dense" : ""}`}>
            {units.map((u, i) => {
              const su = session.units.find((x) => x.id === u.sessionUnitId);
              return (
                <button key={u.sessionUnitId} type="button"
                        aria-current={i === currentIdx ? "step" : undefined}
                        aria-label={`第 ${i + 1} 题${su?.state === "submitted" ? "（已提交）" : ""}`}
                        className={su?.state === "submitted" ? "is-answered" : undefined}
                        onClick={() => setCurrentIdx(i)}>
                  {i + 1}
                  {su?.state === "submitted"
                    ? <span aria-hidden="true" className="strip-mark">✓</span> : null}
                </button>
              );
            })}
          </nav>
        ) : null}

        <SharedMaterialLayout content={content}
          material={<MaterialDisplay unit={vm} materials={materials} />}
          footer={<>
        {submitMsg ? <p role="status">{submitMsg}</p> : null}
        {finishError ? <p role="alert">{finishError}</p> : null}
        {feedback.error ? (
          <p role="alert">解析获取失败：{feedback.error.message}</p>
        ) : null}

        <div className="practice-actions">
          {!unitSubmitted ? (
            <Button variant="primary" loading={submit.isPending}
                    onClick={() => {
                      // Quick Practice §4.2: fully answered → direct submit;
                      // the one confirmation dialog is only for unanswered.
                      if (unanswered > 0) setConfirming(true);
                      else onConfirmSubmit();
                    }}>
              {copy.submitLabel}
            </Button>
          ) : null}
          {!isQuick && allSubmitted && !sessionEnded ? (
            <Button variant="primary" loading={finish.isPending}
                    onClick={onFinish}>
              {session.feedback_mode === "end" ? "交卷并查看结果" : "完成练习"}
            </Button>
          ) : null}
          {isQuick && sessionEnded && !allSubmitted ? (
            // this stale quick session was silently replaced by a newer one
            <div className="practice-post-submit-nav">
              <p className="text-aux">本次练习已被新的练习取代。</p>
              <Button variant="secondary" loading={startQuick.isPending}
                      onClick={() => startQuick.mutate({
                        release_id: sessionUnit?.release_id
                          ?? session.units[0]!.release_id,
                        unit_id: current!.unit.id,
                      })}>
                重新练习本组
              </Button>
            </div>
          ) : null}
          {!isQuick && sessionEnded && !allSubmitted ? (
            <p className="text-aux">
              {session.state === "abandoned"
                ? "这次练习已被新的专项练习取代；已提交的答案保留在历史中。"
                : "练习已提前结束（部分题目未提交）。"}
            </p>
          ) : null}
          {unitSubmitted && (!sessionEnded || isQuick) ? (
            <div className="practice-post-submit-nav">
              {isQuick ? (
                nextQuickUnit ? (
                  <Button variant="primary"
                          loading={startQuick.isPending}
                          onClick={() => startQuick.mutate({
                            release_id: outline.data!.release_id,
                            unit_id: nextQuickUnit.unit_id,
                          })}>
                    {copy.nextLabel}
                  </Button>
                ) : null
              ) : currentIdx + 1 < units.length ? (
                <Button variant="primary"
                        onClick={() => setCurrentIdx(currentIdx + 1)}>
                  下一组
                </Button>
              ) : null}
              {isTopic ? (
                <Button variant="secondary"
                        onClick={() => navigate("/study/practice")}>
                  返回专项练习
                </Button>
              ) : session.units[0]?.exam_id ? (
                <Button variant="secondary"
                        onClick={() => navigate(
                          `/study/exams/${encodeURIComponent(session.units[0]!.exam_id)}`)}>
                  返回试卷
                </Button>
              ) : null}
            </div>
          ) : null}
        
        </div>
          </>}>
        <ol className="question-list">
          {questions.map((q) => {
            const qState = manager.state.questions[q.id];
            const selected = qState
              ? (qState.pendingOptionId ?? qState.optionId) : null;
            const answeredCorrect = feedback.data?.questions
              .find((x) => x.question_id === q.id)?.is_correct === true;
            return (
              <li key={q.id} data-question-id={q.id} className="question-card card">
                <fieldset className="question-fieldset" disabled={unitSubmitted}>
                  <legend>
                    {q.printedNumber ?? `第 ${q.position} 题`}
                    {qState?.status === "save_error" ? (
                      <span className="save-state save-save_error"
                            aria-live="polite">
                        {STATUS_TEXT.save_error}
                      </span>
                    ) : null}
                  </legend>
                  {q.prompt !== null ? (
                    <div lang="ja">
                      <RichText value={q.prompt} slotIds={vm.slotIds} />
                    </div>
                  ) : null}
                  <div role="radiogroup" aria-label={`第 ${q.printedNumber ?? q.position} 题选项`}>
                    {q.options.map((o) => (
                      <label key={o.id} lang="ja"
                             className={`option-row${selected === o.id ? " option-selected" : ""}${selected === o.id && answeredCorrect ? " option-correct" : ""}`}>
                        <input type="radio" name={`q-${q.id}`} value={o.id}
                               checked={selected === o.id}
                               onChange={() => manager.select(q.id, o.id)} />
                        <RichText value={o.content} slotIds={vm.slotIds} />
                      </label>
                    ))}
                  </div>
                </fieldset>
                {feedback.data
                  ? <FeedbackView feedback={feedback.data} questionId={q.id} />
                  : null}
              </li>
            );
          })}
        </ol>
        </SharedMaterialLayout>

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
                   subtitle={title}
                   transcript={current
                     ? { sessionId, sessionUnitId: current.sessionUnitId,
                         allowed: transcriptAllowed }
                     : null} />
      ) : null}
    </div>
  );
}
