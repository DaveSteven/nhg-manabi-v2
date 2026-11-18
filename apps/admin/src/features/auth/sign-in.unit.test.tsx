import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const navigate = vi.fn()
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }))
const adminLogin = vi.fn()
vi.mock('@/lib/api', async (orig) => ({
  ...(await orig<typeof import('@/lib/api')>()),
  adminLogin: (...a: unknown[]) => adminLogin(...a),
}))

import { AxiosError } from 'axios'
import { useAuthStore } from '@/stores/auth-store'
import { renderApp } from '@/test-utils/render'
import { SignInForm } from './sign-in'

const okResponse = {
  token: 'tok', expires_at: 'x',
  admin: { id: 'u1', username: 'admin', display_name: 'Super Admin', role: 'super_admin' },
}

async function fill(user: string, pw: string) {
  const u = userEvent.setup()
  await u.type(screen.getByLabelText('用户名'), user)
  await u.type(screen.getByLabelText('密码'), pw)
  await u.click(screen.getByRole('button', { name: '登录' }))
}

describe('SignInForm', () => {
  beforeEach(() => { navigate.mockReset(); adminLogin.mockReset(); useAuthStore.getState().auth.reset() })

  it('validates required fields without calling the API', async () => {
    renderApp(<SignInForm />)
    await userEvent.setup().click(screen.getByRole('button', { name: '登录' }))
    expect(await screen.findByText('请输入用户名')).not.toBeNull()
    expect(adminLogin).not.toHaveBeenCalled()
  })

  it('signs in: stores token + admin, navigates to the safe redirect', async () => {
    adminLogin.mockResolvedValue(okResponse)
    renderApp(<SignInForm redirectTo='/exams' />)
    await fill('  Admin ', 'pw-pw-pw-pw')
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/exams', replace: true }))
    expect(adminLogin).toHaveBeenCalledWith('admin', 'pw-pw-pw-pw')   // trimmed + lowercased
    expect(useAuthStore.getState().auth.accessToken).toBe('tok')
    expect(useAuthStore.getState().auth.user?.displayName).toBe('Super Admin')
  })

  it('ignores an external redirect target', async () => {
    adminLogin.mockResolvedValue(okResponse)
    renderApp(<SignInForm redirectTo='https://evil.example' />)
    await fill('admin', 'pw-pw-pw-pw')
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/', replace: true }))
  })

  it('shows an alert on bad credentials and stores nothing', async () => {
    adminLogin.mockRejectedValue(new AxiosError('x', '401', undefined, undefined, { status: 401 } as never))
    renderApp(<SignInForm />)
    await fill('admin', 'wrong')
    expect((await screen.findByRole('alert')).textContent).toContain('用户名或密码错误')
    expect(useAuthStore.getState().auth.accessToken).toBe('')
    expect(navigate).not.toHaveBeenCalled()
  })

  it('says the service is unreachable on a network error', async () => {
    adminLogin.mockRejectedValue(new AxiosError('Network Error'))
    renderApp(<SignInForm />)
    await fill('admin', 'whatever')
    expect((await screen.findByRole('alert')).textContent).toContain('无法连接管理服务')
  })
})
