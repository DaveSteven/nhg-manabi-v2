import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { VmContentUnit } from "./viewModel";

/**
 * Long reading / cloze passage (ADR-0018): desktop two-column layout — the
 * article scrolls with the page on the left, the question panel stays
 * `position: sticky` on the right (confined to this unit's wrapper, so it
 * never reaches the next article). Narrow screens stack as before.
 *
 * The panel shows one question at a time (小题切换, ADR-0018 rev.). Linking
 * is display-only DOM wiring: clicking a slot in the article
 * activates its question in the panel; the panel's number chips scroll the
 * article to the slot. Nothing here touches drafts or submission, and the
 * article is never re-rendered by activation.
 */
export function usesSplitLayout(c: VmContentUnit): boolean {
  const hasText = c.materials.some((m) => m.kind === "passage" && m.content);
  return hasText && (c.unit.kind === "passage" || c.unit.slotIds.length > 0);
}

export function SharedMaterialLayout({ content, material, footer, children, numberOf, focusRequest, flow }: {
  content: VmContentUnit;
  /** Display number for a question chip (default: the paper's printed number). */
  numberOf?: (q: VmContentUnit["questions"][number]) => string | number;
  /** Flow mode (short passages): no sticky panel, no one-at-a-time switching —
   * article and ALL its questions simply scroll together. */
  flow?: boolean;
  /** Programmatic activation (exam answer sheet jump): a new `n` re-focuses
   * the question and scrolls its slot into view, like clicking the chip. */
  focusRequest?: { id: string; n: number } | null;
  material: ReactNode;
  footer: ReactNode;
  children: ReactNode; // the question list (<li data-question-id>)
}) {
  const split = usesSplitLayout(content);
  const root = useRef<HTMLDivElement>(null);
  const firstId = content.questions[0]?.id ?? null;
  const [active, setActive] = useState<string | null>(firstId);
  // A new unit starts at its first question.
  useEffect(() => { setActive(firstId); }, [content.unit.id, firstId]);

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

  // The panel shows ONE question at a time (CSS hides the others); every
  // question stays mounted so drafts/answers are never lost on switching.
  const focusQuestion = useCallback((qid: string) => {
    setActive(qid);
    const sc = root.current?.querySelector(".panel-scroll");
    if (sc) sc.scrollTop = 0;
  }, []);

  const gotoQuestion = (qid: string) => {
    focusQuestion(qid);
    const q = content.questions.find((x) => x.id === qid);
    if (q?.slotId) {
      root.current?.querySelector(`[data-slot-id="${CSS.escape(q.slotId)}"]`)
        ?.scrollIntoView?.({ block: "center", behavior: "smooth" });
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

  const activeIdx = content.questions.findIndex((q) => q.id === active);

  return (
    <div className={`shared-material-layout${flow ? " is-flow" : ""}`} ref={root}>
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div className="shared-material-article" onClick={onArticleClick}>
        {material}
      </div>
      <aside className="reading-question-panel" aria-label="答题面板">
        {content.questions.length > 1 && !flow ? (
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
