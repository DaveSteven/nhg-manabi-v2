import { useCallback, useState } from "react";
import { updateMe, type JlptLevel, JLPT_LEVELS } from "../../api/endpoints/auth";
import { authStore, useAuth } from "./authStore";

/**
 * JLPT target-level preference (ADR-0011, v1-pattern dual track): reads
 * the logged-in profile first, falls back to localStorage for guests.
 * setLevel applies locally immediately and best-effort syncs to the
 * server profile (a logged-in user whose PATCH fails keeps the local
 * value; the next successful sync wins).
 */
const LEVEL_KEY = "jlptgo.level";

export { JLPT_LEVELS };
export type { JlptLevel };

function readLocal(): JlptLevel | null {
  try {
    const raw = window.localStorage.getItem(LEVEL_KEY);
    return JLPT_LEVELS.find((l) => l === raw) ?? null;
  } catch {
    return null;
  }
}

function writeLocal(level: JlptLevel | null): void {
  try {
    if (level === null) window.localStorage.removeItem(LEVEL_KEY);
    else window.localStorage.setItem(LEVEL_KEY, level);
  } catch {
    // ignore: storage unavailable
  }
}

export function useLevel(): {
  level: JlptLevel | null;
  setLevel: (level: JlptLevel) => void;
} {
  const auth = useAuth();
  const [guestLevel, setGuestLevel] = useState<JlptLevel | null>(readLocal);

  const setLevel = useCallback((level: JlptLevel) => {
    const user = authStore.get().user;
    if (user) {
      setGuestLevel(level);
      writeLocal(level);
      updateMe({ current_level: level })
        .then((me) => authStore.setUser({
          id: me.id, email: me.email,
          display_name: me.display_name,
          current_level: me.current_level,
          avatar: me.avatar,
        }))
        .catch(() => {
          // best-effort: keep the local choice; server wins on next sync
        });
    } else {
      setGuestLevel(level);
      writeLocal(level);
    }
  }, []);

  return { level: auth.user?.current_level ?? guestLevel, setLevel };
}
