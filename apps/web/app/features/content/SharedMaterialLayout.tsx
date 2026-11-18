import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { VmContentUnit } from "./viewModel";

/**
 * Shared-material layout (ADR-0018, ADR-0021, ADR-0023): desktop two-column layout —
 * the material scrolls with the page on the left, the question panel stays
 * `position: sticky` on the right (confined to this unit's wrapper, so it
 * never reaches the next article). Narrow screens stack as before.
 *
 * Linking is display-only DOM wiring: clicking a slot in the article
 * activates its question in the panel; the panel's number chips scroll the
 * article to the slot. Nothing here touches drafts or submission, and the
 * article is never re-rendered by activation.
 */
export function usesSplitLayout(c: VmContentUnit): boolean {
  const hasText = c.materials.some((m) => m.kind === "passage" && m.content);
  // 信息检索 etc.: the shared material is an image (no article text); it
  // gets the same left-material / right-questions layout as articles.
  const hasImage = c.materials.some((m) => m.kind === "image");
  const hasAudio = c.materials.some((m) => m.kind === "audio");
  if (hasAudio) return hasText && (c.unit.kind === "passage" || c.unit.slotIds.length > 0);
  return (hasText || hasImage)
    && (c.unit.kind === "passage" || c.unit.slotIds.length > 0);
}

export type LayoutMode = "standalone" | "shared-material" | "cloze";

/**
 * ADR-0021: the layout follows the material structure, never the question
 * type name. A slot mapping makes it a cloze; any readable shared material
 * (text or image) makes it shared-material; audio units (listening) and units
 * without material stay standalone.
 */
export function layoutModeOf(c: VmContentUnit): LayoutMode {
  const hasText = c.materials.some((m) => m.kind === "passage" && m.content);
  const hasImage = c.materials.some((m) => m.kind === "image");
  const hasAudio = c.materials.some((m) => m.kind === "audio");
  if (hasAudio) return "standalone";
  if (hasText && c.unit.slotIds.length > 0) return "cloze";
  if (hasText || hasImage) return "shared-material";
  return "standalone";
}

export function SharedMaterialLayout({ content, material, footer, children, numberOf,
  focusRequest, adaptive, onActiveChange, initialActive, onNextMaterial }: {
  content: VmContentUnit;
  /** Display number for a question chip (default: the paper's printed number). */
  numberOf?: (q: VmContentUnit["questions"][number]) => string | number;
  /** ADR-0023 (mock exam): split by material structure (text or image) and
   * ALWAYS show one question at a time with a prev/next pager. */
  adaptive?: boolean;
  /** Question to start on (restoring a material page the user left). */
  initialActive?: string | null;
  /** Adaptive only: when set, the last question's "下一题" becomes "下一篇". */
  onNextMaterial?: () => void;
  /** The panel's active question changed (chip, slot, click, jump). */
  onActiveChange?: (questionId: string) => void;
  /** Programmatic activation (exam answer sheet jump): a new `n` re-focuses
   * the question and scrolls its slot into view, like clicking the chip. */
  focusRequest?: { id: string; n: number } | null;
  material: ReactNode;
  footer: ReactNode;
  children: ReactNode; // the question list (<li data-question-id>)
}) {
  const mode = adaptive ? layoutModeOf(content) : null;
  const split = adaptive ? mode !== "standalone" : usesSplitLayout(content);
  const imageOnly = split && !content.materials.some((m) => m.kind === "passage" && m.content);
  const multi = content.questions.length > 1;
  const root = useRef<HTMLDivElement>(null);
  const firstId = content.questions[0]?.id ?? null;
  const startId = initialActive && content.questions.some((q) => q.id === initialActive)
    ? initialActive : firstId;
  const [active, setActive] = useState<string | null>(startId);
  // A new unit starts at its first question.
  useEffect(() => { setActive(startId); },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [content.unit.id, firstId]);

  // Highlight active question card + slot without re-rendering the article.
  useEffect(() => {
    const el = root.current;
    if (!el || !split) return;
    el.querySelectorAll(".is-active-question").forEach((n) => n.classList.remove("is-active-question"));
    el.querySelectorAll(".is-active-slot").forEach((n) => n.classList.remove("is-active-slot"));
    if (!active) return;
    el.querySelector(`[data-question-id="${CSS.escape(active)}"]`)?.classList.add("is-active-question");
    const q = content.questions.find((x) => x.id === active);
    if (q?.slotId) {
      el.querySelector(`[data-slot-id="${CSS.escape(q.slotId)}"]`)?.classList.add("is-active-slot");
    }
  }, [active, split, content.questions]);

  const onActiveRef = useRef(onActiveChange);
  onActiveRef.current = onActiveChange;
  // The panel shows ONE question at a time when switching (CSS hides the
  // others); every question stays mounted so drafts are never lost.
  const focusQuestion = useCallback((qid: string) => {
    setActive(qid);
    onActiveRef.current?.(qid);
    const sc = root.current?.querySelector(".panel-scroll");
    if (sc) sc.scrollTop = 0;
  }, []);

  const gotoQuestion = (qid: string) => {
    focusQuestion(qid);
    const q = content.questions.find((x) => x.id === qid);
    if (q?.slotId) {
      // only move the page when the slot is not already comfortably visible
      const slot = root.current?.querySelector<HTMLElement>(
        `[data-slot-id="${CSS.escape(q.slotId)}"]`);
      if (slot) {
        const r = slot.getBoundingClientRect();
        const top = parseFloat(getComputedStyle(slot).scrollMarginTop) || 0;
        if (r.top < top || r.bottom > window.innerHeight - 24) {
          slot.scrollIntoView?.({ block: "center", behavior: "smooth" });
        }
      }
    }
  };
  const gotoRef = useRef(gotoQuestion);
  gotoRef.current = gotoQuestion;
  useEffect(() => {
    if (focusRequest && content.questions.some((q) => q.id === focusRequest.id)) {
      gotoRef.current(focusRequest.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest?.n]);

  if (!split) {
    return <>{material}{children}{footer}</>;
  }

  const onArticleClick = (e: React.MouseEvent) => {
    const slot = (e.target as HTMLElement).closest?.("[data-slot-id]");
    const slotId = slot?.getAttribute("data-slot-id");
    const q = content.questions.find((x) => x.slotId === slotId);
    if (q) focusQuestion(q.id);
  };
  // With every question visible, the one being worked on is the active one.
  const onPanelInteract = (e: React.SyntheticEvent) => {
    if (!adaptive) return;
    const qid = (e.target as HTMLElement).closest?.("[data-question-id]")
      ?.getAttribute("data-question-id");
    if (qid && qid !== active) { setActive(qid); onActiveRef.current?.(qid); }
  };

  const activeIdx = content.questions.findIndex((q) => q.id === active);
  const showNav = multi;
  const lastQuestion = activeIdx >= content.questions.length - 1;
  const cls = ["shared-material-layout"];
  if (adaptive) cls.push("is-switch");
  if (imageOnly) cls.push("is-image-material");

  return (
    <div className={cls.join(" ")} ref={root} data-layout-mode={mode ?? undefined}>
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div className="shared-material-article" onClick={onArticleClick}>
        {material}
      </div>
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions */}
      <aside className="reading-question-panel" aria-label="答题面板"
             onClickCapture={onPanelInteract} onFocusCapture={onPanelInteract}>
        {showNav && adaptive ? (
          <nav aria-label="题目切换" className="panel-pager">
            <button type="button" disabled={activeIdx <= 0}
                    onClick={() => gotoQuestion(content.questions[activeIdx - 1]!.id)}>
              ‹ 上一题
            </button>
            <span className="panel-pager-label" aria-live="polite">
              第 {(() => { const q = content.questions[activeIdx]; return q && numberOf ? numberOf(q) : (q?.printedNumber ?? activeIdx + 1); })()} 题
              {" · "}{activeIdx + 1}/{content.questions.length}
            </span>
            {lastQuestion && onNextMaterial ? (
              <button type="button" className="is-next-material" onClick={onNextMaterial}>
                下一篇 ›
              </button>
            ) : (
              <button type="button" disabled={lastQuestion}
                      onClick={() => gotoQuestion(content.questions[activeIdx + 1]!.id)}>
                下一题 ›
              </button>
            )}
          </nav>
        ) : null}
        {showNav && !adaptive ? (
          <nav aria-label="本篇题号" className="panel-question-nav">
            <button type="button" aria-label="上一小题" disabled={activeIdx <= 0}
                    onClick={() => gotoQuestion(content.questions[activeIdx - 1]!.id)}>
              ‹
            </button>
            {content.questions.map((q) => (
              <button key={q.id} type="button"
                      aria-current={q.id === active ? "true" : undefined}
                      onClick={() => gotoQuestion(q.id)}>
                {numberOf ? numberOf(q) : (q.printedNumber ?? q.position)}
              </button>
            ))}
            <button type="button" aria-label="下一小题"
                    disabled={activeIdx >= content.questions.length - 1}
                    onClick={() => gotoQuestion(content.questions[activeIdx + 1]!.id)}>
              ›
            </button>
          </nav>
        ) : null}
        <div className="panel-scroll">{children}</div>
        <div className="panel-footer">{footer}</div>
      </aside>
    </div>
  );
}
