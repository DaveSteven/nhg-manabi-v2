import { describe, expect, it } from "vitest";
import { computePlacement } from "./placement";

const viewport = { width: 1000, height: 800 };
const anchor = (top: number, left = 100, width = 200) =>
  ({ top, bottom: top + 44, left, width });

describe("computePlacement", () => {
  it("opens below the anchor when it fits", () => {
    const p = computePlacement({ anchor: anchor(100),
      content: { width: 150, height: 300 }, viewport });
    expect(p.side).toBe("bottom");
    expect(p.top).toBe(144 + 6);
    expect(p.maxHeight).toBe(300);
    expect(p.width).toBe(200); // never narrower than the anchor
  });

  it("flips above when below is too small and above is larger", () => {
    const p = computePlacement({ anchor: anchor(700),
      content: { width: 150, height: 300 }, viewport });
    expect(p.side).toBe("top");
    expect(p.top + p.maxHeight).toBe(700 - 6); // bottom edge sits above the anchor
    expect(p.maxHeight).toBe(300);
  });

  it("stays below and scrolls when neither side fits but below is larger", () => {
    const p = computePlacement({ anchor: anchor(50),
      content: { width: 150, height: 5000 }, viewport });
    expect(p.side).toBe("bottom");
    expect(p.maxHeight).toBe(800 - 94 - 6 - 8);
  });

  it("caps height on the larger side when it must flip and still not fit", () => {
    const p = computePlacement({ anchor: anchor(600),
      content: { width: 150, height: 5000 }, viewport });
    expect(p.side).toBe("top");
    expect(p.maxHeight).toBe(600 - 6 - 8);
    expect(p.top).toBeGreaterThanOrEqual(8);
  });

  it("clamps horizontally inside the viewport margin (right edge)", () => {
    const p = computePlacement({ anchor: anchor(100, 900, 80),
      content: { width: 220, height: 100 }, viewport });
    expect(p.width).toBe(220);
    expect(p.left + p.width).toBeLessThanOrEqual(1000 - 8);
  });

  it("clamps horizontally (left edge)", () => {
    const p = computePlacement({ anchor: anchor(100, -30, 80),
      content: { width: 120, height: 100 }, viewport });
    expect(p.left).toBe(8);
  });

  it("never exceeds the viewport width", () => {
    const p = computePlacement({ anchor: anchor(100, 0, 100),
      content: { width: 5000, height: 100 }, viewport: { width: 360, height: 640 } });
    expect(p.width).toBe(360 - 16);
    expect(p.left).toBe(8);
  });

  it("respects minWidth", () => {
    const p = computePlacement({ anchor: anchor(100, 100, 60),
      content: { width: 60, height: 100 }, viewport, minWidth: 180 });
    expect(p.width).toBe(180);
  });

  it("caps the height at maxHeight even when there is more room", () => {
    const p = computePlacement({ anchor: anchor(100),
      content: { width: 150, height: 900 }, viewport, maxHeight: 250 });
    expect(p.side).toBe("bottom");
    expect(p.maxHeight).toBe(250);
  });

  it("uses the capped height (not the natural one) to decide whether it fits below", () => {
    // natural 900 would not fit below (only ~156 left → flips), but the
    // 250 cap fits above (700-6-8 = 686) and below does not: flips, 250 high
    const p = computePlacement({ anchor: anchor(650),
      content: { width: 150, height: 900 }, viewport, maxHeight: 250 });
    expect(p.side).toBe("top");
    expect(p.maxHeight).toBe(250);
    // and when the cap does fit below, it stays below
    const q = computePlacement({ anchor: anchor(300),
      content: { width: 150, height: 900 }, viewport, maxHeight: 250 });
    expect(q.side).toBe("bottom");
    expect(q.maxHeight).toBe(250);
  });

  it("still shrinks below the cap when space is tighter than the cap", () => {
    const p = computePlacement({ anchor: anchor(20),
      content: { width: 150, height: 900 }, viewport: { width: 1000, height: 200 },
      maxHeight: 250 });
    expect(p.maxHeight).toBeLessThan(250);
  });
});
