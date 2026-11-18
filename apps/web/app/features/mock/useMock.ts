import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { MockAvailability, MockContent, MockState } from "../../api/dto/mock";
import { ApiError } from "../../api/errors";
import { getCurrentMock, getMock, getMockAvailability,
         getMockContent } from "../../api/endpoints/mock";

export function useMockAvailability(examId: string | undefined) {
  return useQuery<MockAvailability, ApiError>({
    queryKey: ["mock", "availability", examId],
    queryFn: ({ signal }) => getMockAvailability(examId!, signal),
    enabled: !!examId, retry: 0, staleTime: 60_000,
  });
}

/** The user's running mock, or null (404 is the normal idle state). */
export function useCurrentMock(enabled = true) {
  return useQuery<MockState | null, ApiError>({
    queryKey: ["mock", "current"],
    queryFn: async ({ signal }) => {
      try { return await getCurrentMock(signal); }
      catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
    enabled, retry: 0, staleTime: 0,
  });
}

export function useMockState(sessionId: string) {
  return useQuery<MockState, ApiError>({
    queryKey: ["mock", "state", sessionId],
    queryFn: ({ signal }) => getMock(sessionId, signal),
    retry: 0, staleTime: 0,
  });
}

export function useMockContent(sessionId: string, phaseId: string | null) {
  return useQuery<MockContent, ApiError>({
    queryKey: ["mock", "content", sessionId, phaseId],
    queryFn: ({ signal }) => getMockContent(sessionId, signal),
    enabled: phaseId !== null, retry: 0, staleTime: Infinity,
  });
}

/**
 * Seconds left, driven by the SERVER clock: the offset between the server's
 * `server_now` and this device's clock is measured when the state arrives,
 * so a wrong device clock or a refresh can never change the remaining time.
 * `onExpire` fires once per deadline so the page can re-read the (now
 * sealed) state from the server.
 */
export function useServerCountdown(expiresAt: string | null,
                                   serverNow: string | undefined,
                                   onExpire: () => void): number | null {
  // The device-vs-server offset is measured ONCE per server reading (when a
  // new `server_now` arrives). Re-deriving it on every render would cancel
  // the elapsed time out and freeze the clock.
  const reading = useRef<{ serverNow: string | undefined; offset: number }>(
    { serverNow: undefined, offset: 0 });
  if (serverNow && reading.current.serverNow !== serverNow) {
    reading.current = { serverNow, offset: Date.parse(serverNow) - Date.now() };
  }
  const [, tick] = useState(0);
  const fired = useRef<string | null>(null);
  const cb = useRef(onExpire);
  cb.current = onExpire;

  // always computed from the absolute deadline, so no error accumulates
  const left = expiresAt
    ? Math.max(0, Math.ceil(
        (Date.parse(expiresAt) - (Date.now() + reading.current.offset)) / 1000))
    : null;

  useEffect(() => {
    if (!expiresAt) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    // a background tab throttles timers: re-render the moment it is visible
    const onVisible = () => { if (!document.hidden) tick((n) => n + 1); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVisible); };
  }, [expiresAt]);

  useEffect(() => {
    if (expiresAt && left === 0 && fired.current !== expiresAt) {
      fired.current = expiresAt;
      cb.current();
    }
  }, [expiresAt, left]);

  return left;
}
