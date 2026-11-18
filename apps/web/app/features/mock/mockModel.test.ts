import { describe, expect, it } from "vitest";
import { formatClock, minutesLabel, timeTone } from "./mockModel";

describe("mock clock helpers", () => {
  it("formats MM:SS under an hour and H:MM:SS above, never negative", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(-5)).toBe("00:00");
    expect(formatClock(65)).toBe("01:05");
    expect(formatClock(3599)).toBe("59:59");
    expect(formatClock(3600)).toBe("1:00:00");
    expect(formatClock(6300)).toBe("1:45:00");
  });
  it("uses a colour tier near the end (no blinking tier)", () => {
    expect(timeTone(301)).toBe("normal");
    expect(timeTone(300)).toBe("warn");
    expect(timeTone(61)).toBe("warn");
    expect(timeTone(60)).toBe("danger");
  });
  it("shows real minutes, — when unknown", () => {
    expect(minutesLabel(6300)).toBe("105 分钟");
    expect(minutesLabel(null)).toBe("—");
  });
});
