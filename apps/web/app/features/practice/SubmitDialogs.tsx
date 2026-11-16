/**
 * Pre-submit confirmation for unanswered questions (P-008): states the
 * count, offers 返回答题 (no submit) vs 确认提交, and becomes a bottom
 * drawer on mobile via CSS. Skip ≠ wrong is preserved downstream.
 */
export function UnansweredConfirmDialog({ count, submitting, onConfirm, onCancel }: {
  count: number;
  submitting: boolean;
  onConfirm(): void;
  onCancel(): void;
}) {
  return (
    <div role="dialog" aria-modal="true" aria-label="未答题确认"
         className="dialog card">
      <h2>确认提交</h2>
      {count > 0 ? (
        <p>
          本次有 <strong>{count}</strong> 道题未作答。
          你可以继续答题，或确认提交。未作答的题将记为「未答」，与错误答案区分。
        </p>
      ) : (
        <p>本组题目已全部作答。提交后本组将锁定，不能再修改。</p>
      )}
      <div className="dialog-actions">
        <button type="button" onClick={onCancel}>返回答题</button>
        <button type="button" className="primary" disabled={submitting}
                onClick={onConfirm}>
          {submitting ? "提交中…" : "确认提交"}
        </button>
      </div>
    </div>
  );
}

export interface ConflictDialogProps {
  questionId: string;
  onAdoptServer(): void;
  onOverwrite(): void;
}

/**
 * 409 draft_version_conflict resolution — the user explicitly chooses;
 * no silent overwrite (design-system interaction matrix).
 */
export function DraftConflictDialog({ questionId, onAdoptServer, onOverwrite }: ConflictDialogProps) {
  return (
    <div role="dialog" aria-modal="true" aria-label="草稿冲突"
         className="dialog card">
      <h2>草稿版本冲突</h2>
      <p>
        题目 <code>{questionId}</code> 的草稿在其它设备或窗口被修改。
        采用服务器上的最新值，或以你当前的选择覆盖（使用最新版本号）。
      </p>
      <div className="dialog-actions">
        <button type="button" onClick={onAdoptServer}>采用服务器值</button>
        <button type="button" className="primary" onClick={onOverwrite}>
          以我的选择覆盖
        </button>
      </div>
    </div>
  );
}
