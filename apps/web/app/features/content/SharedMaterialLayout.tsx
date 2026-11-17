import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { VmContentUnit } from "./viewModel";

/**
 * Long reading / cloze passage (ADR-0018): desktop two-column layout — the
 * article scrolls with the page on the left, the question panel stays
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
  return hasText && (c.unit.kind === "passage" || c.unit.slotIds.length > 0);
}

export function SharedMaterialLayout({ content, material, footer, children }: {
  content: VmContentUnit;
  material: ReactNode;
  footer: ReactNode;
  children: ReactNode; // the question list (<li data-question-id>)
}) {
  const split = usesSplitLayout(content);
  const root = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<string | null>(null);

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

  const focusQuestion = useCallback((qid: string) => {
    setActive(qid);
    root.current?.querySelector(`[data-question-id="${CSS.escape(qid)}"]`)
      ?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, []);

  if (!split) {
    return <>{material}{children}{footer}</>;
  }

  const onArticleClick = (e: React.MouseEvent) => {
    const slot = (e.target as HTMLElement).closest?.("[data-slot-id]");
    const slotId = slot?.getAttribute("data-slot-id");
    const q = content.questions.find((x) => x.slotId === slotId);
    if (q) focusQuestion(q.id);
  };

  const gotoQuestion = (qid: string) => {
    focusQuestion(qid);
    const q = content.questions.find((x) => x.id === qid);
    if (q?.slotId) {
      root.current?.querySelector(`[data-slot-id="${CSS.escape(q.slotId)}"]`)
        ?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    }
  };

  return (
    <div className="shared-material-layout" ref={root}>
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div className="shared-material-article" onClick={onArticleClick}>
        {material}
      </div>
      <aside className="reading-question-panel" aria-label="答题面板">
        {content.questions.length > 1 ? (
          <nav aria-label="本篇题号" className="panel-question-nav">
            {content.questions.map((q) => (
              <button key={q.id} type="button"
                      onClick={() => gotoQuestion(q.id)}>
                {q.printedNumber ?? q.position}
              </button>
            ))}
          </nav>
        ) : null}
        <div className="panel-scroll">{children}</div>
        <div className="panel-footer">{footer}</div>
      </aside>
    </div>
  );
}
