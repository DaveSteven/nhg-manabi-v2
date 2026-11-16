/**
 * DEV-ONLY bearer token (ADR-0006 dev_test identity).
 *
 * In AUTH_MODE=dev_test the backend treats the bearer token itself as the
 * test user UUID (must be listed in DEV_TEST_USER_IDS) and hard-disables
 * this mechanism in production. There is no real login flow in M2.2; the
 * token comes from build-time env or a localStorage override used by dev
 * tooling. Replace `getBearerToken` when real authentication lands.
 */
const STORAGE_KEY = "dev_user_token";

export function getBearerToken(): string | null {
  if (import.meta.env.VITE_DEV_USER_TOKEN) {
    return import.meta.env.VITE_DEV_USER_TOKEN;
  }
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Prerender build or storage-disabled context: no token.
    return null;
  }
}

export function setDevUserToken(token: string | null): void {
  try {
    if (token === null) {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, token);
    }
  } catch {
    // ignore: storage unavailable
  }
}
