import { describe, expect, it } from "vitest";
import { nextSitting } from "./examDates";

describe("nextSitting", () => {
  it("counts whole days to the next sitting with a weekday label", () => {
    const n = nextSitting(new Date(2026, 10, 18, 15, 30));
    expect(n?.daysLeft).toBe(18);
    expect(n?.text).toBe("12月6日 周日");
    expect(n?.sitting.label).toBe("JLPT 冬季统考");
  });
  it("is 0 on the exam day and null once all sittings have passed", () => {
    expect(nextSitting(new Date(2026, 11, 6, 23, 0))?.daysLeft).toBe(0);
    expect(nextSitting(new Date(2026, 11, 7))).toBeNull();
  });
  it("skips past sittings", () => {
    expect(nextSitting(new Date(2026, 6, 6))?.sitting.date).toBe("2026-12-06");
  });
});
