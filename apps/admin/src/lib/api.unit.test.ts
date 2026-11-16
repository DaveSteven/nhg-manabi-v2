import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { AxiosError } from 'axios'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { adminLogin, adminLogout, adminMe, describeLoginError } from './api'
import { useAuthStore } from '@/stores/auth-store'

const admin = { id: 'u1', username: 'admin', display_name: 'Super Admin', role: 'super_admin' }
const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => { server.resetHandlers(); useAuthStore.getState().auth.reset() })
afterAll(() => server.close())

describe('admin api', () => {
  it('login posts credentials and parses the strict response', async () => {
    let body: unknown
    server.use(http.post('*/api/admin/auth/login', async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({ token: 't', expires_at: 'x', admin })
    }))
    const out = await adminLogin('admin', 'pw')
    expect(body).toEqual({ username: 'admin', password: 'pw' })
    expect(out.admin.role).toBe('super_admin')
  })

  it('rejects an unexpected response shape instead of trusting it', async () => {
    server.use(http.post('*/api/admin/auth/login', () =>
      HttpResponse.json({ token: 't', expires_at: 'x', admin, extra: 1 })))
    await expect(adminLogin('admin', 'pw')).rejects.toThrow()
  })

  it('sends the Bearer token from the store on protected calls', async () => {
    useAuthStore.getState().auth.setAccessToken('secret-token')
    let auth: string | null = null
    server.use(http.get('*/api/admin/auth/me', ({ request }) => {
      auth = request.headers.get('authorization')
      return HttpResponse.json(admin)
    }))
    expect((await adminMe()).username).toBe('admin')
    expect(auth).toBe('Bearer secret-token')
  })

  it('logout calls the endpoint', async () => {
    let hit = false
    server.use(http.post('*/api/admin/auth/logout', () => { hit = true; return new HttpResponse(null, { status: 204 }) }))
    await adminLogout()
    expect(hit).toBe(true)
  })

  it('describeLoginError separates bad credentials from an unreachable service', async () => {
    server.use(http.post('*/api/admin/auth/login', () =>
      HttpResponse.json({ detail: 'invalid credentials' }, { status: 401 })))
    const bad = await adminLogin('a', 'b').catch((e) => e)
    expect(bad).toBeInstanceOf(AxiosError)
    expect(describeLoginError(bad)).toContain('用户名或密码错误')
    server.use(http.post('*/api/admin/auth/login', () => HttpResponse.error()))
    const down = await adminLogin('a', 'b').catch((e) => e)
    expect(describeLoginError(down)).toContain('无法连接管理服务')
    server.use(http.post('*/api/admin/auth/login', () => new HttpResponse(null, { status: 500 })))
    const five = await adminLogin('a', 'b').catch((e) => e)
    expect(describeLoginError(five)).toContain('无法连接管理服务')
  })
})
