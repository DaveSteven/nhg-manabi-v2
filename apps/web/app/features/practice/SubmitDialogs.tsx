/**
 * Pre-submit confirmation, ONLY for unanswered questions (quick-practice
 * spec §4.2/§8): fully-answered groups submit directly with no dialog.
 * Skip ≠ wrong is preserved downstream.
 */
export function UnansweredConfirmDialog({ count, submitting, onConfirm, onCancel,
                                         scope = "本组" }: {
  count: number;
  /** 本组 (per-unit submit) | 本次练习 (统一反馈 final submit). */
  scope?: string;
  submitting: boolean;
  onConfirm(): void;
  onCancel(): void;
}) {
  return (
    <div role="dialog" aria-modal="true" aria-label="还有题目未作答"
         className="dialog card">
      <h2>还有题目未作答</h2>
      <p>
        {scope}还有 <strong>{count}</strong> 题未作答。提交后将无法修改，确定继续吗？
      </p>
      <div className="dialog-actions">
        <button type="button" onClick={onCancel}>继续答题</button>
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
