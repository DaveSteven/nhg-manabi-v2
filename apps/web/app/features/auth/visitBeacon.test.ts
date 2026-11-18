import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("../../api/client", () => ({ apiFetch }));

import { sendVisitOnce, tokyoDay } from "./visitBeacon";

describe("visit beacon", () => {
  beforeEach(() => {
    window.localStorage.clear();
    apiFetch.mockReset();
    apiFetch.mockResolvedValue(null);
  });

  it("uses the Asia/Tokyo calendar day", () => {
    expect(tokyoDay(new Date("2026-11-17T16:00:00Z"))).toBe("2026-11-18");
    expect(tokyoDay(new Date("2026-11-17T14:59:00Z"))).toBe("2026-11-17");
  });

  it("pings once per user per Tokyo day", async () => {
    const t = new Date("2026-11-18T01:00:00Z");
    await sendVisitOnce("u1", t);
    await sendVisitOnce("u1", t);
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch).toHaveBeenCalledWith("/api/me/visit", { method: "POST" });
    await sendVisitOnce("u1", new Date("2026-11-19T01:00:00Z"));
    await sendVisitOnce("u2", new Date("2026-11-19T01:00:00Z"));
    expect(apiFetch).toHaveBeenCalledTimes(3);
  });

  it("swallows failures and retries next time", async () => {
    apiFetch.mockRejectedValueOnce(new Error("offline"));
    const t = new Date("2026-11-18T01:00:00Z");
    await expect(sendVisitOnce("u1", t)).resolves.toBeUndefined();
    await sendVisitOnce("u1", t);
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });
});
