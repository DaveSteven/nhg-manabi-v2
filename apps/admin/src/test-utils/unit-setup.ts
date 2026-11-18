import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// antd reads these browser APIs that happy-dom does not provide.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia
}
class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= NoopObserver as unknown as typeof ResizeObserver

afterEach(() => {
  cleanup()
  sessionStorage.clear()
  try {
    window.localStorage.clear()
  } catch {
    /* Node's experimental localStorage is unavailable */
  }
})
