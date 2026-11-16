import {
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { computePlacement } from "./placement";

/**
 * Popover (select-spec.md §3) — NOT a Modal: no overlay, closes on outside
 * press or Esc, never blocks the page. Rendered through a portal with
 * position:fixed so ancestors' overflow/transform can't clip it, and
 * re-placed against the viewport (flip / clamp / cap height) on scroll,
 * resize and content size changes.
 */
export function Popover({ open, anchorRef, onClose, minWidth, maxHeight,
                          className, children }: {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  /** `restoreFocus` is true for Esc (caller returns focus to the anchor). */
  onClose: (reason: "escape" | "outside") => void;
  minWidth?: number;
  /** Height cap in px; content beyond it scrolls inside. */
  maxHeight?: number;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useLayoutEffect(() => {
    if (!open) return;
    const el = ref.current;
    const anchor = anchorRef.current;
    if (!el || !anchor) return;

    const place = () => {
      // measure the natural size first, then constrain
      el.style.maxHeight = "none";
      el.style.width = "max-content";
      const natural = { width: el.offsetWidth, height: el.offsetHeight };
      const a = anchor.getBoundingClientRect();
      const p = computePlacement({
        anchor: { top: a.top, bottom: a.bottom, left: a.left, width: a.width },
        content: natural,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        minWidth,
        maxHeight,
      });
      el.style.top = `${p.top}px`;
      el.style.left = `${p.left}px`;
      el.style.width = `${p.width}px`;
      el.style.maxHeight = `${p.maxHeight}px`;
      el.dataset.side = p.side;
    };

    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    const ro = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(place) : null;
    ro?.observe(el);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      ro?.disconnect();
    };
  }, [open, anchorRef, minWidth, maxHeight]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchorRef.current?.contains(t)) return;
      onCloseRef.current("outside");
    };
    // capture + stopPropagation: Esc closes only this popover, never a
    // Modal underneath it that also listens for Esc.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onCloseRef.current("escape");
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, anchorRef]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div ref={ref} className={`popover${className ? ` ${className}` : ""}`}
         style={{ position: "fixed", top: 0, left: 0 }}>
      {children}
    </div>,
    document.body,
  );
}
