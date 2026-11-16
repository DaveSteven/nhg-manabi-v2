import { create } from 'zustand'

/**
 * Admin session state (ADR-0009). The opaque session token lives in
 * sessionStorage (cleared when the tab closes, not sent automatically with
 * requests like a cookie). It is never written to the build or the URL.
 * The route guard (routes/_authenticated/route.tsx) validates it against
 * the server on every protected navigation; this store is only a cache.
 */
const TOKEN_KEY = 'jlptgo_admin_token'

export interface AuthAdmin {
  id: string
  username: string
  displayName: string
  role: string
}

interface AuthState {
  auth: {
    user: AuthAdmin | null
    setUser: (user: AuthAdmin | null) => void
    accessToken: string
    setAccessToken: (accessToken: string) => void
    resetAccessToken: () => void
    reset: () => void
  }
}

function readToken(): string {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? ''
  } catch {
    return ''
  }
}

function writeToken(token: string) {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token)
    else sessionStorage.removeItem(TOKEN_KEY)
  } catch {
    /* storage unavailable: session lives in memory only */
  }
}

export const useAuthStore = create<AuthState>()((set) => ({
  auth: {
    user: null,
    setUser: (user) =>
      set((state) => ({ ...state, auth: { ...state.auth, user } })),
    accessToken: readToken(),
    setAccessToken: (accessToken) =>
      set((state) => {
        writeToken(accessToken)
        return { ...state, auth: { ...state.auth, accessToken } }
      }),
    resetAccessToken: () =>
      set((state) => {
        writeToken('')
        return { ...state, auth: { ...state.auth, accessToken: '' } }
      }),
    reset: () =>
      set((state) => {
        writeToken('')
        return {
          ...state,
          auth: { ...state.auth, user: null, accessToken: '' },
        }
      }),
  },
}))
