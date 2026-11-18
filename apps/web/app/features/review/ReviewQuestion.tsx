import type { FeedbackPayload } from "../../api/dto/practice";
import { toViewModel } from "../content/toViewModel";
import { SharedMaterialLayout } from "../content/SharedMaterialLayout";
import { MaterialDisplay } from "../content/MaterialDisplay";
import { RichText } from "../content/richtext/RichText";
import { AudioDock } from "../content/AudioDock/AudioDock";
import { Button } from "../../components/Button";
import { resultVerdict } from "../practice/resultsModel";

export type Verdict = "correct" | "wrong" | "skipped";

export const VERDICT_TEXT: Record<Verdict, string> = {
  correct: "正确", wrong: "错误", skipped: "未答",
};
export const VERDICT_MARK: Record<Verdict, string> = {
  correct: "✓", wrong: "×", skipped: "",
};

/** The slice of a result row the review view needs (practice and mock). */
export interface ReviewAnswer {
  question_id: string;
  chosen_option_id: string | null;
  correct_option_id: string | null;
  is_correct: boolean | null;
  skipped: boolean;
}

/** Which backend serves this review's listening transcript. */
export type TranscriptSource = "practice" | "mock";

export type ReviewContent = { sessionUnitId: string; vm: ReturnType<typeof toViewModel> };

export function ReviewQuestion({ sessionId, content, active, activeIdx, total, feedback,
  feedbackError, focus, seqOf, onActivate, onPrev, onNext,
  transcriptSource = "practice" }: {
  sessionId: string;
  content: ReviewContent;
  active: ReviewAnswer;
  activeIdx: number;
  total: number;
  feedback: FeedbackPayload | undefined;
  feedbackError: Error | null;
  focus: { id: string; n: number } | null;
  seqOf: (questionId: string) => number;
  onActivate: (questionId: string) => void;
  onPrev: () => void;
  onNext: () => void;
  transcriptSource?: TranscriptSource;
}) {
  const vm = content.vm;
  const q = vm.questions.find((x) => x.id === active.question_id);
  const hasSlots = vm.unit.slotIds.length > 0;
  const displayNo = (x: { id: string; printedNumber: string | null; position: number }) =>
    hasSlots ? (x.printedNumber ?? x.position) : seqOf(x.id);
  const verdict = resultVerdict(active);
  const fq = feedback?.questions.find((x) => x.question_id === active.question_id);
  const audioMaterial = vm.materials.find((m) => m.audio?.kind === "url");
  const audioUrl = audioMaterial?.audio?.kind === "url" ? audioMaterial.audio.url : null;

  if (!q) return <p role="alert">找不到该题的内容。</p>;

  return (
    <>
      <SharedMaterialLayout content={vm} numberOf={displayNo}
        material={<MaterialDisplay unit={vm.unit} materials={vm.materials} />}
        initialActive={active.question_id}
        focusRequest={focus}
        onActiveChange={onActivate}
        footer={
          <nav aria-label="题目翻页" className="review-pager">
            <Button variant="secondary" disabled={activeIdx <= 0} onClick={onPrev}>
              上一题
            </Button>
            <span className="text-aux review-pager-label" aria-live="polite">
              {activeIdx + 1} / {total}
            </span>
            <Button variant="secondary" disabled={activeIdx >= total - 1} onClick={onNext}>
              下一题
            </Button>
          </nav>
        }>
        <ol className="question-list">
          <li key={q.id} data-question-id={q.id}
              className={`question-card card review-question`}>
            <h2 className="review-question-head">
              <span className="review-question-no">
                {hasSlots && q.printedNumber ? q.printedNumber : `第 ${displayNo(q)} 题`}
              </span>
              <span className={`review-badge is-${verdict}`}>
                {VERDICT_MARK[verdict]
                  ? <span aria-hidden="true">{VERDICT_MARK[verdict]} </span> : null}
                {VERDICT_TEXT[verdict]}
              </span>
            </h2>
            {q.prompt !== null ? (
              <div lang="ja">
                <RichText value={q.prompt} slotIds={vm.unit.slotIds} />
              </div>
            ) : null}
            <ul className="review-options" aria-label="选项">
              {q.options.map((o) => {
                const chosen = active.chosen_option_id === o.id;
                const correct = active.correct_option_id === o.id;
                const cls = ["option-row", "review-option",
                  chosen ? "is-chosen" : "",
                  correct ? "is-correct" : "",
                  chosen && !correct ? "is-wrong" : ""].filter(Boolean).join(" ");
                return (
                  <li key={o.id} lang="ja" className={cls}>
                    <RichText value={o.content} slotIds={vm.unit.slotIds} />
                    {chosen || correct ? (
                      <span className="review-tags">
                        {chosen ? (
                          <span className={`review-tag ${correct ? "is-ok" : "is-bad"}`}>
                            {correct ? "" : <span aria-hidden="true">× </span>}你的答案
                          </span>
                        ) : null}
                        {correct ? (
                          <span className="review-tag is-ok">
                            <span aria-hidden="true">✓ </span>正确答案
                          </span>
                        ) : null}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {verdict === "skipped" ? (
              <p className="text-aux review-unanswered">未作答</p>
            ) : null}
            {feedbackError ? (
              <p role="alert">解析获取失败：{feedbackError.message}</p>
            ) : !feedback ? (
              <p role="status" className="text-aux">加载解析中…</p>
            ) : (
              <div className="review-explanation">
                {feedback.unit_explanations.map((e, i) => (
                  <div key={`u${i}`} className="feedback-explanation">
                    <RichText value={e.content} />
                  </div>
                ))}
                {(fq?.explanations ?? []).map((e, i) => (
                  <div key={i} className="feedback-explanation">
                    <RichText value={e.content} />
                  </div>
                ))}
              </div>
            )}
          </li>
        </ol>
      </SharedMaterialLayout>
      {audioUrl ? (
        <AudioDock src={audioUrl} subtitle={`练习 · ${vm.unit.label ?? `组 ${vm.unit.position}`}`}
                   transcript={{ sessionId, sessionUnitId: content.sessionUnitId,
                                 allowed: true, source: transcriptSource }} />
      ) : null}
    </>
  );
}
