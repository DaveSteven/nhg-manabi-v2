/**
 * Popover placement (select-spec.md §3): pure geometry so it can be unit
 * tested without a layout engine. Opens below the anchor; flips above when
 * the space below is too small and above is larger; clamps horizontally
 * inside the viewport; caps height to the available space.
 */
export interface Rect {
  top: number;
  bottom: number;
  left: number;
  width: number;
}

export interface PlacementInput {
  anchor: Rect;
  /** Natural (unclamped) popover size. */
  content: { width: number; height: number };
  viewport: { width: number; height: number };
  gap?: number;
  margin?: number;
  minWidth?: number;
}

export interface Placement {
  side: "bottom" | "top";
  top: number;
  left: number;
  width: number;
  maxHeight: number;
}

export function computePlacement(input: PlacementInput): Placement {
  const gap = input.gap ?? 6;
  const margin = input.margin ?? 8;
  const { anchor, content, viewport } = input;

  const spaceBelow = viewport.height - anchor.bottom - gap - margin;
  const spaceAbove = anchor.top - gap - margin;
  const fitsBelow = content.height <= spaceBelow;
  const side: "bottom" | "top" =
    fitsBelow || spaceBelow >= spaceAbove ? "bottom" : "top";

  const available = Math.max(0, side === "bottom" ? spaceBelow : spaceAbove);
  const maxHeight = Math.min(content.height, available);
  const top = side === "bottom"
    ? anchor.bottom + gap
    : anchor.top - gap - maxHeight;

  const maxWidth = Math.max(0, viewport.width - 2 * margin);
  const wanted = Math.max(anchor.width, input.minWidth ?? 0, content.width);
  const width = Math.min(wanted, maxWidth);
  const left = Math.min(
    Math.max(anchor.left, margin),
    viewport.width - margin - width,
  );

  return { side, top, left: Math.max(left, margin), width, maxHeight };
}
