import { beforeEach, describe, expect, it, vi } from 'vitest'

async function load() {
  vi.resetModules()
  return (await import('./auth-store')).useAuthStore
}

describe('admin auth store', () => {
  beforeEach(() => sessionStorage.clear())

  it('starts empty', async () => {
    const s = await load()
    expect(s.getState().auth.accessToken).toBe('')
    expect(s.getState().auth.user).toBeNull()
  })

  it('persists the token in sessionStorage only (never a cookie)', async () => {
    const s = await load()
    s.getState().auth.setAccessToken('tok-123')
    expect(sessionStorage.getItem('jlptgo_admin_token')).toBe('tok-123')
    expect(document.cookie).not.toContain('tok-123')
    expect((await load()).getState().auth.accessToken).toBe('tok-123')
  })

  it('reset clears token and user', async () => {
    const s = await load()
    s.getState().auth.setAccessToken('tok-123')
    s.getState().auth.setUser({ id: '1', username: 'admin', displayName: 'A', role: 'super_admin' })
    s.getState().auth.reset()
    expect(s.getState().auth.accessToken).toBe('')
    expect(s.getState().auth.user).toBeNull()
    expect(sessionStorage.getItem('jlptgo_admin_token')).toBeNull()
  })
})
