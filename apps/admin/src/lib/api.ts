import axios, { AxiosError } from 'axios'
import { z } from 'zod'
import { useAuthStore } from '@/stores/auth-store'

/**
 * FastAPI client (same-origin `/api`; Vite dev proxy / static host proxy).
 * The Bearer token is an opaque admin session token (ADR-0009): it is read
 * from the auth store per request, never embedded in the build.
 */
export const api = axios.create({ baseURL: '' })

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().auth.accessToken
  if (token) config.headers.set('Authorization', `Bearer ${token}`)
  return config
})

const adminSchema = z.strictObject({
  id: z.string(),
  username: z.string(),
  display_name: z.string(),
  role: z.string(),
})
const loginSchema = z.strictObject({
  token: z.string().min(1),
  expires_at: z.string(),
  admin: adminSchema,
})

export type AdminProfile = z.infer<typeof adminSchema>

export async function adminLogin(username: string, password: string) {
  const res = await api.post('/api/admin/auth/login', {
    username,
    password,
  })
  return loginSchema.parse(res.data)
}

export async function adminMe(): Promise<AdminProfile> {
  const res = await api.get('/api/admin/auth/me')
  return adminSchema.parse(res.data)
}

export async function adminLogout(): Promise<void> {
  await api.post('/api/admin/auth/logout')
}

/** User-facing wording; distinguishes bad credentials from an unreachable service. */
export function describeLoginError(error: unknown): string {
  if (error instanceof AxiosError) {
    const status = error.response?.status
    if (status === 401) return '用户名或密码错误，或账号已被锁定/停用。'
    if (status === undefined || status >= 500) {
      return '无法连接管理服务，请确认后端已启动后重试。'
    }
  }
  return '登录失败，请稍后重试。'
}
