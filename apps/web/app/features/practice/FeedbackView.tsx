import type { FeedbackPayload } from "../../api/dto/practice";
import { RichText } from "../content/richtext/RichText";

export function FeedbackView({ feedback, questionId }: {
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
