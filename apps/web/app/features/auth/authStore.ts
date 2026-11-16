import { useSyncExternalStore } from "react";
import type { UserProfile } from "../../api/endpoints/auth";
import { setSessionToken } from "../../api/authToken";

/**
 * Student auth session (ADR-0011): the bearer token lives in localStorage
 * (via authToken) with the cached profile beside it. Plain pub/sub store
 * + useSyncExternalStore — no react-query for auth state because it must
 * be synchronous for the bearer header on every API call.
 */
const PROFILE_KEY = "jlptgo.auth.profile";

export interface AuthState {
  token: string | null;
  user: UserProfile | null;
}

function load(): AuthState {
  try {
    const raw = window.localStorage.getItem(PROFILE_KEY);
    if (!raw) return { token: null, user: null };
    const parsed = JSON.parse(raw) as Partial<AuthState>;
    if (typeof parsed.token !== "string" || !parsed.user ||
        typeof parsed.user.email !== "string") {
      return { token: null, user: null };
    }
    return { token: parsed.token, user: parsed.user as UserProfile };
  } catch {
    return { token: null, user: null };
  }
}

let state: AuthState = typeof window === "undefined"
  ? { token: null, user: null }
  : load();
const listeners = new Set<() => void>();

function persist(next: AuthState): void {
  try {
    if (next.token === null) {
      window.localStorage.removeItem(PROFILE_KEY);
    } else {
      window.localStorage.setItem(PROFILE_KEY, JSON.stringify(next));
    }
  } catch {
    // storage unavailable: in-memory state still works for this page
  }
}

function setState(next: AuthState): void {
  state = next;
  persist(next);
  listeners.forEach((l) => l());
}

export const authStore = {
  get: (): AuthState => state,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  setSession(token: string, user: UserProfile): void {
    setSessionToken(token);
    setState({ token, user });
  },
  setUser(user: UserProfile): void {
    setState({ ...state, user });
  },
  clear(): void {
    setSessionToken(null);
    setState({ token: null, user: null });
  },
};

export function useAuth(): AuthState {
  return useSyncExternalStore(authStore.subscribe, authStore.get);
}
