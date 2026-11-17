import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import type { FinishResponse } from "../../api/dto/practice";
import { ApiError } from "../../api/errors";
import { getDrafts, getSession, getUnitFeedback, submitSession } from "../../api/endpoints/sessions";
import { toViewModel } from "../content/toViewModel";
import { MaterialDisplay } from "../content/MaterialDisplay";
import { RichText } from "../content/richtext/RichText";
import { AudioDock } from "../content/AudioDock/AudioDock";
import type { SessionBundle } from "./useSessionRestore";
import { useDraftManager } from "./useDraftManager";
import { useFeedback } from "./useFeedback";
import { FeedbackView } from "./FeedbackView";
import { PracticeBreadcrumb } from "./PracticeBreadcrumb";
import { DraftConflictDialog, UnansweredConfirmDialog } from "./SubmitDialogs";
import { clearSessionPendingRetries, loadPendingRetries } from "./pendingRetries";
import { Button, ButtonLink } from "../../components/Button";
import { quickPracticeCopy } from "./quickPracticeCopy";

/**
 * 统一反馈 practice (frontend-spec 专项练习流程, practice-interactions):
 * the whole session is ONE flow of questions. Choosing an answer only saves
 * a draft; 上一组 / 下一组 / the number strip merely move around, so every
 * answer stays editable until the single final submit
 * (POST /sessions/{id}/submit) which judges the entire session in one
 * server transaction. Correct answers, explanations and the score exist only
 * after that — this page never requests them before the session ends (the
 * backend gate is the real boundary).
 *
 * A Unit is never split (ADR-0017): one page = one Unit, showing its shared
 * material and ALL of its questions; paging moves between Units only.
 */
export function UnifiedPracticeView({ sessionId, bundle }: {
  sessionId: string;
  bundle: SessionBundle;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { session } = bundle;
  const ended = session.state !== "in_progress";
  const completed = session.state === "completed";

  const contents = useMemo(() => bundle.units.map((u) => ({
    sessionUnitId: u.sessionUnitId,
    vm: toViewModel(u.unit),
  })), [bundle.units]);
  const flat = useMemo(() => contents.flatMap((c, ui) =>
    c.vm.questions.map((q, qi) => ({ ui, qi, qid: q.id }))), [contents]);
  const unitOfQuestion = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of contents) {
      for (const q of c.vm.questions) m.set(q.id, c.sessionUnitId);
    }
    return m;
  }, [contents]);

  const manager = useDraftManager(sessionId, contents[0]?.sessionUnitId ?? "", {
    persist: !ended,
    unitOf: (qid) => unitOfQuestion.get(qid),
  });

  // Refresh restore: every server draft of the session (all units) is
  // hydrated once; newer local retry records (failed saves) are merged.
  const hydrated = useRef(false);
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    manager.registerQuestions(flat.map((f) => f.qid));
    const server = bundle.drafts.map((d) => ({
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

  const [idx, setIdx] = useState(0); // Unit index
  const content = contents[Math.min(idx, contents.length - 1)];

  const sessionUnit = session.units.find((u) => u.id === content?.sessionUnitId);
  const unitSubmitted = sessionUnit?.state === "submitted";

  // After the session ended, review the submitted choices + explanations
  // (gate opens server-side only then).
  const feedback = useFeedback(sessionId, content?.sessionUnitId ?? "", "end",
    { unitSubmitted, sessionEnded: ended });
  useEffect(() => {
    if (!ended || !feedback.data) return;
    manager.hydrate(feedback.data.questions.map((q) => ({
      questionId: q.question_id, optionId: q.chosen_option_id, rowVersion: 0,
    })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ended, feedback.data]);

  // Review verdicts for the whole strip: after the session ended the gate
  // is open for every submitted unit (same query keys as useFeedback, so
  // the current unit's request is shared). Never enabled before then.
  const verdictQueries = useQueries({
    queries: contents.map((c) => {
      const su = session.units.find((u) => u.id === c.sessionUnitId);
      return {
        queryKey: ["feedback", sessionId, c.sessionUnitId],
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          getUnitFeedback(sessionId, c.sessionUnitId, signal),
        enabled: ended && su?.state === "submitted",
        retry: 0,
        staleTime: Infinity,
      };
    }),
  });
  const verdictOf = new Map<string, "correct" | "wrong" | "skipped">();
  for (const q of verdictQueries) {
    for (const fq of q.data?.questions ?? []) {
      verdictOf.set(fq.question_id,
        fq.skipped || fq.is_correct === null ? "skipped"
          : fq.is_correct ? "correct" : "wrong");
    }
  }

  const total = flat.length;
  const unanswered = flat.filter((f) => {
    const v = manager.displayValue(f.qid);
    return v === null || v === "";
  }).length;
  void manager.state; // re-render on draft changes (displayValue reads a ref)

  const [confirming, setConfirming] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const goResults = useCallback(() => {
    clearSessionPendingRetries(sessionId);
    void queryClient.invalidateQueries({ queryKey: ["session", "current"] });
    void queryClient.invalidateQueries({ queryKey: ["session-bundle", sessionId] });
    navigate(`/study/practice/${encodeURIComponent(sessionId)}/results`);
  }, [navigate, queryClient, sessionId]);

  const finalSubmit = useMutation<FinishResponse, ApiError, void>({
    mutationFn: () => submitSession(sessionId, flat.map((f) => ({
      session_unit_id: unitOfQuestion.get(f.qid)!,
      question_id: f.qid,
      chosen_option_id: (manager.displayValue(f.qid) || null),
    }))),
    onSuccess: goResults,
    onError: async (error) => {
      setConfirming(false);
      if (error.status === 0 || error.code === "network_error") {
        // Timeout: the server may have completed it — check before retrying.
        try {
          const s = await getSession(sessionId);
          if (s.state === "completed") { goResults(); return; }
        } catch { /* fall through to the explicit error */ }
      }
      setSubmitError(`提交失败：${error.message}。你的答案仍保留，可重试。`);
    },
  });

  const onFinalClick = () => {
    setSubmitError(null);
    if (unanswered > 0) setConfirming(true);
    else finalSubmit.mutate();
  };

  const resolveConflict = useCallback(async (questionId: string, mode: "adopt" | "overwrite") => {
    const drafts = await getDrafts(sessionId);
    const row = drafts.drafts.find((d) => d.question_id === questionId);
    if (mode === "adopt") {
      manager.adoptServer(questionId, row?.chosen_option_id ?? null, row?.row_version ?? 0);
    } else {
      manager.overwriteAfterConflict(questionId, row?.row_version ?? 0);
    }
  }, [manager, sessionId]);

  if (!content || content.vm.questions.length === 0) {
    return <p role="status">这次练习没有可作答的题目。</p>;
  }

  const vm = content.vm.unit;
  const isLast = idx === contents.length - 1;
  const unitQuestions = content.vm.questions;
  const copy = quickPracticeCopy(content.vm.unit.kind, unitQuestions.length);
  const prevLabel = copy.nextLabel.replace("下", "上");
  const firstNo = flat.findIndex((f) => f.ui === idx) + 1;

  const audioMaterial = content.vm.materials.find((m) => m.audio?.kind === "url");
  const audioUrl = audioMaterial?.audio?.kind === "url" ? audioMaterial.audio.url : null;

  return (
    <div className="practice-shell">
      <main className="container">
        <PracticeBreadcrumb current="练习" topic examId={null} />
        <header className="practice-header">
          <h1>专项练习 · {vm.label ?? `组 ${vm.position}`}</h1>
          <p className="text-aux">
            统一反馈：全部提交后统一揭晓答案与成绩 ·{" "}
            <span aria-live="polite">第 {idx + 1} / {contents.length} 组</span>
            {` · 第 ${firstNo}${unitQuestions.length > 1
              ? `–${firstNo + unitQuestions.length - 1}` : ""} / ${total} 题`}
          </p>
        </header>

        <nav aria-label="题组导航" className="unit-nav question-strip">
          {contents.map((c, i) => {
            const qids = c.vm.questions.map((q) => q.id);
            const answeredN = qids.filter((id) => {
              const v = manager.displayValue(id);
              return v !== null && v !== "";
            }).length;
            const vs = ended ? qids.map((id) => verdictOf.get(id)) : [];
            const verdict = !ended || vs.some((v) => v === undefined) ? undefined
              : vs.includes("wrong") ? "wrong"
              : vs.every((v) => v === "correct") ? "correct" : "skipped";
            const status = verdict
              ? { correct: "全对", wrong: "有错", skipped: "有未答" }[verdict]
              : answeredN === qids.length ? "已选"
              : answeredN > 0 ? "部分已选" : "未答";
            return (
              <button key={c.sessionUnitId} type="button"
                      aria-current={i === idx ? "step" : undefined}
                      aria-label={`第 ${i + 1} 组（${status}）`}
                      className={verdict ? `is-${verdict}`
                        : answeredN === qids.length ? "is-answered" : undefined}
                      onClick={() => setIdx(i)}>
                {i + 1}
                {verdict === "correct" ? <span aria-hidden="true" className="strip-mark">✓</span>
                  : verdict === "wrong" ? <span aria-hidden="true" className="strip-mark">✗</span>
                  : null}
              </button>
            );
          })}
        </nav>

        <MaterialDisplay unit={vm} materials={content.vm.materials} />

        <ol className="question-list">
          {unitQuestions.map((question) => {
            const qState = manager.state.questions[question.id];
            const selected = qState ? (qState.pendingOptionId ?? qState.optionId) : null;
            const fq = feedback.data?.questions.find((x) => x.question_id === question.id);
            const answeredCorrect = fq?.is_correct === true;
            return (
              <li key={question.id} className="question-card card">
                <fieldset className="question-fieldset" disabled={ended}>
                  <legend>
                    {question.printedNumber ?? `第 ${question.position} 题`}
                    {qState?.status === "save_error" ? (
                      <span className="save-state save-save_error" aria-live="polite">
                        保存失败，可重试
                      </span>
                    ) : null}
                  </legend>
                  {question.prompt !== null ? (
                    <div lang="ja">
                      <RichText value={question.prompt} slotIds={vm.slotIds} />
                    </div>
                  ) : null}
                  <div role="radiogroup"
                       aria-label={`第 ${question.printedNumber ?? question.position} 题选项`}>
                    {question.options.map((o) => (
                      <label key={o.id} lang="ja"
                             className={`option-row${selected === o.id ? " option-selected" : ""}${selected === o.id && answeredCorrect ? " option-correct" : ""}`}>
                        <input type="radio" name={`q-${question.id}`} value={o.id}
                               checked={selected === o.id}
                               onChange={() => manager.select(question.id, o.id)} />
                        <RichText value={o.content} slotIds={vm.slotIds} />
                      </label>
                    ))}
                  </div>
                </fieldset>
                {ended && feedback.data
                  ? <FeedbackView feedback={feedback.data} questionId={question.id} />
                  : null}
              </li>
            );
          })}
        </ol>

        {ended && feedback.error ? (
          <p role="alert">解析获取失败：{feedback.error.message}</p>
        ) : null}
        {submitError ? <p role="alert">{submitError}</p> : null}

        <div className="practice-actions">
          <Button variant="secondary" className="pager-btn" disabled={idx === 0}
                  onClick={() => setIdx((i) => Math.max(0, i - 1))}>
            {prevLabel}
          </Button>
          {!isLast ? (
            <Button variant={ended && completed ? "secondary" : "primary"}
                    className="pager-btn"
                    onClick={() => setIdx((i) => Math.min(contents.length - 1, i + 1))}>
              {copy.nextLabel}
            </Button>
          ) : !ended ? (
            <Button variant="primary"
                    loading={finalSubmit.isPending} onClick={onFinalClick}>
              {finalSubmit.isPending ? "提交中…" : "完成并提交练习"}
            </Button>
          ) : null}
          {ended ? (
            completed ? (
              <ButtonLink variant="primary" to={`/study/practice/${encodeURIComponent(sessionId)}/results`}>
                查看结果
              </ButtonLink>
            ) : (
              <p className="text-aux">
                {session.state === "abandoned"
                  ? "这次练习已被新的专项练习取代；已提交的答案保留在历史中。"
                  : "练习已提前结束，未生成完整成绩。"}
              </p>
            )
          ) : null}
          <Button variant="secondary" onClick={() => navigate("/study/practice")}>
            返回专项练习
          </Button>
        </div>

        {confirming ? (
          <UnansweredConfirmDialog count={unanswered} scope="本次练习"
                                   submitting={finalSubmit.isPending}
                                   onConfirm={() => finalSubmit.mutate()}
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
                   transcript={{ sessionId, sessionUnitId: content.sessionUnitId,
                                 allowed: ended && unitSubmitted }} />
      ) : null}
    </div>
  );
}
