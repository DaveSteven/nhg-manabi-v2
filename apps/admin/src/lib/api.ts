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

// ---- exam / release management (ADR-0010) ---------------------------------

const releaseSchema = z.strictObject({
  id: z.string(),
  revision: z.number().int(),
  state: z.string(),
  is_current: z.boolean(),
  published_at: z.string().nullable(),
})

const publicationSchema = z.strictObject({
  decision: z.string(),
  reviewer_id: z.string().nullable(),
  note: z.unknown(),
  decided_at: z.string(),
})

export const adminExamSchema = z.strictObject({
  exam_id: z.string(),
  level: z.string(),
  year: z.number().int(),
  month: z.number().int(),
  title: z.string(),
  status: z.enum(['published', 'withdrawn', 'unpublished']),
  release: releaseSchema.nullable(),
  counts: z.strictObject({
    units: z.number().int(),
    hidden_units: z.number().int(),
    questions: z.number().int(),
    unverified_answer_keys: z.number().int(),
  }),
  publication: publicationSchema.nullable(),
})
export type AdminExam = z.infer<typeof adminExamSchema>

export async function listAdminExams(): Promise<AdminExam[]> {
  const res = await api.get('/api/admin/exams')
  return z.strictObject({ exams: z.array(adminExamSchema) }).parse(res.data).exams
}

export async function withdrawRelease(releaseId: string, reason: string) {
  await api.post(`/api/admin/releases/${encodeURIComponent(releaseId)}/withdraw`, {
    reason: reason.trim() || null,
  })
}

export async function restoreRelease(releaseId: string) {
  await api.post(`/api/admin/releases/${encodeURIComponent(releaseId)}/restore`)
}

/** Message for a failed release action, using the server's stable error code. */
export function describeReleaseError(error: unknown): string {
  if (error instanceof AxiosError) {
    const code = (error.response?.data as { detail?: { code?: string } } | undefined)
      ?.detail?.code
    if (code === 'not_published') return '该版本当前不是已发布状态，请刷新列表。'
    if (code === 'not_withdrawn') return '该版本当前不是已下架状态，请刷新列表。'
    if (code === 'exam_has_current_release') {
      return '这套试卷已有正在发布的版本，请先下架它再恢复旧版本。'
    }
    if (error.response?.status === 401) return '登录已过期，请重新登录。'
    if (error.response?.status === undefined || error.response.status >= 500) {
      return '无法连接管理服务，请稍后重试。'
    }
  }
  return '操作失败，请稍后重试。'
}

// ---- dashboard (platform-wide operating statistics) ------------------------

const rate = z.number().nullable()
export const dashboardSchema = z.strictObject({
  range: z.strictObject({
    days: z.number().int(), start: z.string(), end: z.string(), timezone: z.string(),
  }),
  metrics: z.strictObject({
    registered_users: z.number().int(), active_learners: z.number().int(),
    new_users: z.number().int(), answered_questions: z.number().int(),
  }),
  daily: z.array(z.strictObject({
    date: z.string(), learning: z.number().int(), visit: z.number().int().nullable(),
  })),
  visit_tracking: z.strictObject({
    available: z.boolean(), since: z.string().nullable(), note: z.string(),
  }),
  features: z.array(z.strictObject({
    key: z.string(), label: z.string(), users: z.number().int(),
    starts: z.number().int(), completions: z.number().int(), completion_rate: rate,
  })),
  funnel: z.strictObject({
    visit_users: z.number().int().nullable(),
    started_users: z.number().int(), completed_users: z.number().int(),
    visit_to_start_rate: rate, start_to_complete_rate: rate, note: z.string(),
  }),
  alerts: z.array(z.strictObject({
    key: z.string(), label: z.string(), count: z.number().int(),
    scope: z.enum(['range', 'current']),
  })),
})
export type Dashboard = z.infer<typeof dashboardSchema>

export async function getDashboard(days: 7 | 30): Promise<Dashboard> {
  const res = await api.get('/api/admin/dashboard', { params: { days } })
  return dashboardSchema.parse(res.data)
}
