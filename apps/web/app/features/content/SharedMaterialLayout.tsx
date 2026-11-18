import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { VmContentUnit } from "./viewModel";

/**
 * Shared-material layout (ADR-0018, ADR-0021): desktop two-column layout —
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
  return hasText && (c.unit.kind === "passage" || c.unit.slotIds.length > 0);
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

/** Extra space a panel must clear before it switches back to "all visible"
 * after it once needed switching — avoids flapping at the threshold. */
const FIT_HYSTERESIS = 40;

export function SharedMaterialLayout({ content, material, footer, children, numberOf,
  focusRequest, adaptive, chipState, onActiveChange }: {
  content: VmContentUnit;
  /** Display number for a question chip (default: the paper's printed number). */
  numberOf?: (q: VmContentUnit["questions"][number]) => string | number;
  /** ADR-0021 (mock exam): split by material structure (text or image), and
   * show ALL questions while they fit the viewport; only when they don't, the
   * panel switches to one question at a time with number chips. */
  adaptive?: boolean;
  /** Answered / flagged state for the number chips. */
  chipState?: (questionId: string) => { answered: boolean; flagged: boolean };
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
  const [active, setActive] = useState<string | null>(firstId);
  // adaptive panels start with everything visible; measuring may switch them
  const [fit, setFit] = useState<boolean>(!!adaptive);
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
  }, [active, split, content.questions, fit]);

  // Fit-or-switch (ADR-0021): measure the panel with every question shown
  // (synchronously, before paint) against the space under the sticky offset.
  useLayoutEffect(() => {
    const el = root.current;
    if (!adaptive || !split || !multi || !el) return;
    const measure = () => {
      const list = el.querySelector<HTMLElement>(".panel-scroll");
      if (!list) return;
      if (window.innerWidth < 1024) { setFit(true); return; } // stacked: show all
      el.classList.add("is-measuring");
      const need = list.scrollHeight;
      el.classList.remove("is-measuring");
      // the panel's resolved sticky `top` (the CSS var is an unevaluated calc)
      const panel = el.querySelector<HTMLElement>(".reading-question-panel");
      const offset = (panel && parseFloat(getComputedStyle(panel).top)) || 104;
      const avail = window.innerHeight - offset - 24;
      setFit((prev) => (prev ? need <= avail : need <= avail - FIT_HYSTERESIS));
    };
    measure();
    window.addEventListener("resize", measure);
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => measure());
      ro.observe(el);
      const list = el.querySelector(".panel-scroll > *");
      if (list) ro.observe(list);
    }
    return () => { window.removeEventListener("resize", measure); ro?.disconnect(); };
  }, [adaptive, split, multi, content.unit.id]);

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
  // With every question visible, the one being worked on is the active one.
  const onPanelInteract = (e: React.SyntheticEvent) => {
    if (!adaptive) return;
    const qid = (e.target as HTMLElement).closest?.("[data-question-id]")
      ?.getAttribute("data-question-id");
    if (qid && qid !== active) { setActive(qid); onActiveRef.current?.(qid); }
  };

  const activeIdx = content.questions.findIndex((q) => q.id === active);
  const showNav = multi && !(adaptive && fit);
  const cls = ["shared-material-layout"];
  if (adaptive) cls.push(fit ? "is-fit" : "is-switch");
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
        {showNav ? (
          <nav aria-label="本篇题号" className="panel-question-nav">
            <button type="button" aria-label="上一小题" disabled={activeIdx <= 0}
                    onClick={() => gotoQuestion(content.questions[activeIdx - 1]!.id)}>
              ‹
            </button>
            {content.questions.map((q) => {
              const st = chipState?.(q.id);
              const chipCls = [st?.answered ? "is-answered" : "", st?.flagged ? "is-flagged" : ""]
                .filter(Boolean).join(" ");
              return (
                <button key={q.id} type="button" className={chipCls || undefined}
                        aria-current={q.id === active ? "true" : undefined}
                        onClick={() => gotoQuestion(q.id)}>
                  {numberOf ? numberOf(q) : (q.printedNumber ?? q.position)}
                  {st?.answered ? <span className="sr-only">已作答</span> : null}
                  {st?.flagged ? <span className="sr-only">已标记</span> : null}
                </button>
              );
            })}
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
