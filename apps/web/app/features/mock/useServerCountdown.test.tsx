import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { useServerCountdown } from "./useMock";

function Clock({ expires, serverNow, onExpire }: {
  expires: string; serverNow: string; onExpire: () => void;
}) {
  const left = useServerCountdown(expires, serverNow, onExpire);
  return <p role="timer">{left}</p>;
}

describe("useServerCountdown", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-18T10:00:00Z")); });
  afterEach(() => { vi.useRealTimers(); });

  it("counts down every second from the absolute server deadline", () => {
    render(<Clock serverNow="2026-11-18T10:00:00Z" expires="2026-11-18T11:45:00Z"
                  onExpire={() => {}} />);
    expect(screen.getByRole("timer")).toHaveTextContent("6300");
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByRole("timer")).toHaveTextContent("6299");
    act(() => { vi.advanceTimersByTime(59_000); });
    expect(screen.getByRole("timer")).toHaveTextContent("6240");
  });

  it("uses the SERVER clock even when the device clock is wrong", () => {
    // device says 10:00, server says 09:00 → 1h45m left, not 45m
    render(<Clock serverNow="2026-11-18T09:00:00Z" expires="2026-11-18T10:45:00Z"
                  onExpire={() => {}} />);
    expect(screen.getByRole("timer")).toHaveTextContent("6300");
    act(() => { vi.advanceTimersByTime(5000); });
    expect(screen.getByRole("timer")).toHaveTextContent("6295");
  });

  it("keeps running across re-renders and fires onExpire once at zero", () => {
    const onExpire = vi.fn();
    const { rerender } = render(<Clock serverNow="2026-11-18T10:00:00Z"
      expires="2026-11-18T10:00:03Z" onExpire={onExpire} />);
    rerender(<Clock serverNow="2026-11-18T10:00:00Z" expires="2026-11-18T10:00:03Z"
                    onExpire={onExpire} />);
    act(() => { vi.advanceTimersByTime(2000); });
    expect(screen.getByRole("timer")).toHaveTextContent("1");
    expect(onExpire).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1500); });
    expect(screen.getByRole("timer")).toHaveTextContent("0");
    expect(onExpire).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(5000); });
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it("catches up after a throttled background tab", () => {
    render(<Clock serverNow="2026-11-18T10:00:00Z" expires="2026-11-18T11:00:00Z"
                  onExpire={() => {}} />);
    vi.setSystemTime(new Date("2026-11-18T10:10:00Z"));   // tab slept 10 min
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(screen.getByRole("timer")).toHaveTextContent("3000");
  });
});
