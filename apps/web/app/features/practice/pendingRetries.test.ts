import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadPendingRetries,
  recordPendingRetry,
  restorePendingRetries,
} from "./pendingRetries";

const S = "s1";
const retry = (questionId: string, optionId: string | null, knownVersion: number) =>
  recordPendingRetry({ sessionId: S, questionId, optionId, knownVersion, time: "t" });

function target() {
  return { select: vi.fn(), clear: vi.fn() };
}

describe("R1 · restorePendingRetries", () => {
  beforeEach(() => window.localStorage.clear());

  it("restores a failed change when server version equals knownVersion", () => {
    retry("q1", "B", 1); // server A/v1, offline select B
    const t = target();
    restorePendingRetries(S, [{ questionId: "q1", optionId: "A", rowVersion: 1 }],
      t, new Set(["q1"]));
    expect(t.select).toHaveBeenCalledWith("q1", "B");
    expect(loadPendingRetries(S)).toHaveLength(1); // kept until a server ack
  });

  it("restores a failed first answer (0/0, no server draft)", () => {
    retry("q1", "B", 0);
    const t = target();
    restorePendingRetries(S, [], t, new Set(["q1"]));
    expect(t.select).toHaveBeenCalledWith("q1", "B");
  });

  it("restores a failed clear as clear, not select('')", () => {
    retry("q1", null, 1);
    const t = target();
    restorePendingRetries(S, [{ questionId: "q1", optionId: "A", rowVersion: 1 }],
      t, new Set(["q1"]));
    expect(t.clear).toHaveBeenCalledWith("q1");
    expect(t.select).not.toHaveBeenCalled();
  });

  it("server moved on (lost response or other device): server wins, record dropped", () => {
    retry("q1", "B", 1);
    const t = target();
    restorePendingRetries(S, [{ questionId: "q1", optionId: "B", rowVersion: 2 }],
      t, new Set(["q1"]));
    expect(t.select).not.toHaveBeenCalled();
    expect(loadPendingRetries(S)).toHaveLength(0);
  });

  it("clears and restores per question, only inside the scope", () => {
    retry("q1", "B", 1);   // restorable
    retry("q2", "C", 5);   // stale → dropped
    retry("q3", "D", 0);   // other unit/phase → untouched
    const t = target();
    restorePendingRetries(S, [
      { questionId: "q1", optionId: "A", rowVersion: 1 },
      { questionId: "q2", optionId: "X", rowVersion: 6 },
    ], t, new Set(["q1", "q2"]));
    expect(t.select).toHaveBeenCalledTimes(1);
    expect(t.select).toHaveBeenCalledWith("q1", "B");
    expect(loadPendingRetries(S).map((e) => e.questionId).sort()).toEqual(["q1", "q3"]);
  });
});
