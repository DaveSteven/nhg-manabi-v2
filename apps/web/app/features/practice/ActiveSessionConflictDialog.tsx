import { useState } from "react";
import type { ActiveSessionConflict } from "./useStartPractice";

export interface ConflictDialogProps {
  conflict: ActiveSessionConflict;
  /** 继续旧练习 → navigate to the existing session. */
  onContinue(): void;
  /** End the old session, then retry starting the new one. */
  onEndAndStart(conflict: ActiveSessionConflict): void;
  onCancel(): void;
}

/**
 * One-active-practice rule (P-010): starting a new practice while one is
 * in progress must ask. Ending the old session with pending units means
 * ended_early — submitted answers are kept, no fabricated score; the
 * dialog states this before acting.
 */
export function ActiveSessionConflictDialog(
  { conflict, onContinue, onEndAndStart, onCancel }: ConflictDialogProps) {
  const [confirmingEnd, setConfirmingEnd] = useState(false);

  return (
    <div role="dialog" aria-modal="true" aria-label="已有进行中的练习"
         className="dialog card">
      <h2>已有进行中的练习</h2>
      {conflict.activeSessionId ? (
        <p className="sr-only">会话 {conflict.activeSessionId}</p>
      ) : null}

      {!confirmingEnd ? (
        <>
          <p>你可以继续旧的练习，或结束后再开始新的练习。</p>
          <div className="dialog-actions">
            <button type="button" className="primary" onClick={onContinue}>
              继续旧练习
            </button>
            <button type="button" onClick={() => setConfirmingEnd(true)}>
              结束旧练习后开始
            </button>
            <button type="button" onClick={onCancel}>取消</button>
          </div>
        </>
      ) : (
        <>
          <p>
            旧练习中<strong>尚未正式提交的题目</strong>不会计分；
            已提交的答案会保留，但不会生成一份完整练习成绩。
            确定结束旧练习吗？
          </p>
          <div className="dialog-actions">
            <button type="button" className="danger"
                    onClick={() => onEndAndStart(conflict)}>
              确认结束并开始新练习
            </button>
            <button type="button" onClick={() => setConfirmingEnd(false)}>
              返回
            </button>
          </div>
        </>
      )}
    </div>
  );
}
