import { create } from 'zustand'

/** Light/dark preference only (UI state, not server state). */
const KEY = 'minao_admin_theme'
export type ThemeMode = 'light' | 'dark'

function read(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'light' || v === 'dark') return v
  } catch {
    /* storage unavailable */
  }
  return 'light'
}

interface ThemeState {
  mode: ThemeMode
  toggle: () => void
}

export const useThemeStore = create<ThemeState>()((set, get) => ({
  mode: read(),
  toggle: () => {
    const mode: ThemeMode = get().mode === 'light' ? 'dark' : 'light'
    try {
      localStorage.setItem(KEY, mode)
    } catch {
      /* ignore */
    }
    set({ mode })
  },
}))
