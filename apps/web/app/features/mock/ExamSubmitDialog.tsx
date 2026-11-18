import { Button } from "../../components/Button";

/** Phase hand-in confirmation: the numbers the user needs to decide, then
 * "返回检查" / "确认". Unanswered questions may be handed in (skip != wrong). */
export function ExamSubmitDialog({ final, answered, unanswered, flagged,
  submitting, onConfirm, onCancel }: {
  final: boolean;
  answered: number;
  unanswered: number;
  flagged: number;
  submitting: boolean;
  onConfirm(): void;
  onCancel(): void;
}) {
  return (
    <div className="exam-dialog-layer">
      <div role="dialog" aria-modal="true" aria-label={final ? "确认交卷" : "确认结束本阶段"}
           className="dialog card exam-dialog">
        <h2>{final ? "确认交卷" : "确认结束本阶段"}</h2>
        <dl className="exam-dialog-stats">
          <div><dt>已作答</dt><dd>{answered}</dd></div>
          <div><dt>未作答</dt><dd>{unanswered}</dd></div>
          <div><dt>标记待检查</dt><dd>{flagged}</dd></div>
        </dl>
        <p className="text-aux">
          {final ? "交卷后" : "结束本阶段后"}将无法回看或修改本阶段的答案
          {final ? "，并立即生成成绩。" : "，剩余时间不会顺延到下一阶段。"}
          未作答的题目按未答处理，不算答错。
        </p>
        <div className="dialog-actions">
          <Button variant="secondary" onClick={onCancel}>返回检查</Button>
          <Button variant="primary" loading={submitting} onClick={onConfirm}>
            {submitting ? "提交中…" : final ? "确认交卷" : "确认结束本阶段"}
          </Button>
        </div>
      </div>
    </div>
  );
}
