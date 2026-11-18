import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/Button";
import type { ExamGroup } from "./mockModel";

/**
 * The single answer sheet of the exam (right-hand overlay). It is a fixed
 * layer over the page: the page behind keeps its width and scroll position,
 * so a long article never re-wraps. Groups follow the paper's own 大题
 * structure of the active phase; numbers show answered / current / flagged
 * only — never right or wrong.
 */
export function AnswerSheetDrawer({ open, onClose, groups, currentGroupIdx,
  currentQid, isAnswered, flags, onJump, actionLabel, onAction, phaseTitle }: {
  open: boolean;
  onClose(): void;
  groups: ExamGroup[];
  currentGroupIdx: number;
  currentQid: string | null;
  isAnswered(qid: string): boolean;
  flags: Set<string>;
  onJump(qid: string): void;
  actionLabel: string;
  onAction(): void;
  phaseTitle: string;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const closeRef = useRef<HTMLButtonElement>(null);
  const lastFocus = useRef<HTMLElement | null>(null);

  // groups other than the current one start folded; the user's own
  // expand/collapse choices survive until the current group changes
  useEffect(() => {
    setCollapsed(new Set(groups.filter((_, i) => i !== currentGroupIdx).map((g) => g.layerId)));
  }, [groups, currentGroupIdx]);

  useEffect(() => {
    if (!open) return;
    lastFocus.current = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      lastFocus.current?.focus?.();
    };
  }, [open, onClose]);

  const all = groups.flatMap((g) => g.questions);
  const answered = all.filter((q) => isAnswered(q.qid)).length;
  const flagged = all.filter((q) => flags.has(q.qid)).length;

  return (
    <div className={`sheet-root${open ? " is-open" : ""}`} aria-hidden={!open}>
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div className="sheet-scrim" onClick={onClose} />
      <aside className="sheet-panel" role="dialog" aria-modal="true" aria-label="答题卡">
        <header className="sheet-head">
          <div>
            <h2>答题卡</h2>
            <p className="sheet-summary" aria-live="polite">
              已作答 {answered} · 未作答 {all.length - answered} · 标记 {flagged}
            </p>
            <p className="text-aux">{phaseTitle}</p>
          </div>
          <button ref={closeRef} type="button" className="sheet-close"
                  aria-label="关闭答题卡" onClick={onClose}>×</button>
        </header>

        <div className="sheet-body">
          {groups.map((g, gi) => {
            const isCollapsed = collapsed.has(g.layerId);
            const done = g.questions.filter((q) => isAnswered(q.qid)).length;
            return (
              <section key={g.layerId} className="sheet-group">
                <button type="button" className="sheet-group-head"
                        aria-expanded={!isCollapsed}
                        onClick={() => setCollapsed((c) => {
                          const n = new Set(c);
                          if (n.has(g.layerId)) n.delete(g.layerId); else n.add(g.layerId);
                          return n;
                        })}>
                  <span aria-hidden="true">{isCollapsed ? "▸" : "▾"}</span>
                  <span className="sheet-group-title">{g.label}</span>
                  <span className="sheet-group-count">{done}/{g.questions.length}</span>
                </button>
                {!isCollapsed ? (
                  <ul className="sheet-grid">
                    {g.questions.map((q) => {
                      const isCur = q.qid === currentQid;
                      const status = isAnswered(q.qid) ? "已作答" : "未作答";
                      const flag = flags.has(q.qid);
                      return (
                        <li key={q.qid}>
                          <button type="button"
                                  className={["sheet-no",
                                    isAnswered(q.qid) ? "is-answered" : "",
                                    isCur ? "is-current" : "",
                                    flag ? "is-flagged" : ""].filter(Boolean).join(" ")}
                                  aria-label={`${g.label} 第 ${q.no} 题，${status}${flag ? "，已标记" : ""}${isCur ? "，当前题" : ""}`}
                                  aria-current={isCur ? "true" : undefined}
                                  data-group-index={gi}
                                  onClick={() => onJump(q.qid)}>
                            {q.no}
                            {flag ? <span className="sheet-flag" aria-hidden="true">⚑</span> : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </section>
            );
          })}
        </div>

        <footer className="sheet-foot">
          <Button variant="secondary" onClick={onClose}>返回作答</Button>
          <Button variant="primary" onClick={onAction}>{actionLabel}</Button>
        </footer>
      </aside>
    </div>
  );
}
