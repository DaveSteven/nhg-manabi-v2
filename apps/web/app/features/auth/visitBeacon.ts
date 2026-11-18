import { useEffect } from "react";
import { apiFetch } from "../../api/client";
import { useAuth } from "./authStore";

/**
 * Dashboard visit ping: tells the server a signed-in student opened the
 * learning app today (Asia/Tokyo). Sent at most once per user per day per
 * browser; the server is idempotent anyway. Carries no body, no path, no
 * identifiers beyond the bearer token. Failures are silent — analytics must
 * never affect learning.
 */
const KEY = "minao.visit.last";

export function tokyoDay(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(now);
}

export async function sendVisitOnce(userId: string, now: Date = new Date()): Promise<void> {
  const stamp = `${userId}:${tokyoDay(now)}`;
  try {
    if (window.localStorage.getItem(KEY) === stamp) return;
    await apiFetch("/api/me/visit", { method: "POST" });
    window.localStorage.setItem(KEY, stamp);
  } catch {
    // retried on the next page load
  }
}

export function useVisitBeacon(): void {
  const { token, user } = useAuth();
  const userId = user?.id ?? null;
  useEffect(() => {
    if (token && userId) void sendVisitOnce(userId);
  }, [token, userId]);
}
