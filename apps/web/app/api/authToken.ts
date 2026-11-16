/**
 * Bearer token resolution (ADR-0011).
 *
 * The student session token (opaque, 30 days, server-side SHA-256) lives
 * in localStorage under a dedicated key; authStore (features/auth) keeps
 * it in sync with the cached profile. VITE_DEV_USER_TOKEN remains the
 * dev-tooling override (ADR-0006 dev_test identity, production-disabled
 * server-side). Replace getBearerToken again when real auth hardens.
 */
const SESSION_KEY = "jlptgo.session_token";

export function getBearerToken(): string | null {
  if (import.meta.env.VITE_DEV_USER_TOKEN) {
    return import.meta.env.VITE_DEV_USER_TOKEN;
  }
  try {
    return window.localStorage.getItem(SESSION_KEY);
  } catch {
    // Prerender build or storage-disabled context: no token.
    return null;
  }
}

export function setSessionToken(token: string | null): void {
  try {
    if (token === null) {
      window.localStorage.removeItem(SESSION_KEY);
    } else {
      window.localStorage.setItem(SESSION_KEY, token);
    }
  } catch {
    // ignore: storage unavailable
  }
}
