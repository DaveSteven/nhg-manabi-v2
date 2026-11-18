import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UserDetail, UserList } from '@/lib/api'

const { listAdminUsers, getAdminUser, setUserDisabled } = vi.hoisted(() => ({
  listAdminUsers: vi.fn(), getAdminUser: vi.fn(), setUserDisabled: vi.fn(),
}))
vi.mock('@/lib/api', async (orig) => ({
  ...(await orig<typeof import('@/lib/api')>()),
  listAdminUsers: (q: unknown) => listAdminUsers(q),
  getAdminUser: (id: string) => getAdminUser(id),
  setUserDisabled: (...a: unknown[]) => setUserDisabled(...a),
}))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <a className={className}>{children}</a>
  ),
}))
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  LineChart: () => <div data-testid='line-chart' />,
  Line: () => null, XAxis: () => null, YAxis: () => null, Tooltip: () => null, CartesianGrid: () => null,
}))

import { pickOption, renderApp } from '@/test-utils/render'
import { UserDetailPage } from './detail'
import { UsersPanel } from './index'

const user = (over = {}) => ({
  id: 'u1', email: 'alice@example.com', display_name: 'Alice', current_level: 'N2',
  created_at: '2026-11-01T15:30:00+00:00', account_state: 'normal' as const,
  activity: 'active' as const, last_visit_date: null as string | null,
  last_learn_at: '2026-11-17T01:00:00+00:00', days_7d: 4, answers_7d: 52, ...over,
})
const list = (items = [user()]): UserList => ({
  total: items.length, page: 1, page_size: 20, items,
  summary: { total_users: 120, active_7d: 33, not_started: 9 }, timezone: 'Asia/Tokyo',
})
const detail = (over: Partial<UserDetail> = {}): UserDetail => ({
  user: { ...user(), activated_at: '2026-11-01T15:31:00+00:00', disabled_at: null },
  stats: { total_answers: 800, completed_sessions: 41, active_days_30: 12, answers_30: 300 },
  daily_30: [{ date: '2026-11-18', answers: 5 }],
  features: [{ key: 'quick', label: '快速练习', starts: 10, completions: 8 }],
  subjects: [{ subject: 'grammar', label: '文法', answers: 77 }],
  recent: [{ session_id: 's1', mode: 'practice', state: 'completed',
    happened_at: '2026-11-17T01:00:00+00:00', level: 'N2',
    source: { kind: 'topic', label: '文法 · 接续' }, correct: 3, wrong: 1, skipped: 1,
    total: 5, answered_accuracy: 0.75 }],
  audit: [], timezone: 'Asia/Tokyo', ...over,
})

const wrap = renderApp

describe('UsersPanel', () => {
  beforeEach(() => { vi.clearAllMocks(); listAdminUsers.mockResolvedValue(list()) })

  it('shows summary, a row, and a dash (not login time) for missing visit', async () => {
    wrap(<UsersPanel />)
    expect(await screen.findByText('Alice')).toBeTruthy()
    expect(screen.getByText('120')).toBeTruthy()
    expect(screen.getByText('33')).toBeTruthy()
    expect(screen.getByText('4/7 天')).toBeTruthy()
    expect(screen.getAllByText('活跃').some((e) => e.tagName === 'SPAN')).toBe(true)
    expect(screen.getByText('2026-11-02')).toBeTruthy()   // 15:30Z = Tokyo next day
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })

  it('flags a disabled account separately from activity', async () => {
    listAdminUsers.mockResolvedValue(list([user({ account_state: 'disabled', activity: 'dormant' })]))
    wrap(<UsersPanel />)
    await screen.findByText('Alice')
    expect(screen.getAllByText('已禁用').map((e) => e.tagName)).toContain('SPAN')
    expect(screen.getAllByText('长期沉默').map((e) => e.tagName)).toContain('SPAN')
  })

  it('sends filters and resets to page 1; empty result is explained', async () => {
    wrap(<UsersPanel />)
    await screen.findByText('Alice')
    listAdminUsers.mockResolvedValue({ ...list([]), total: 0 })
    await pickOption('按活跃状态筛选', '长期沉默')
    await waitFor(() => expect(listAdminUsers).toHaveBeenLastCalledWith(
      expect.objectContaining({ activity: 'dormant', page: 1 })))
    expect(await screen.findByText('没有符合条件的用户。')).toBeTruthy()
  })

  it('debounces search', async () => {
    wrap(<UsersPanel />)
    await screen.findByText('Alice')
    await userEvent.type(screen.getByLabelText('搜索用户'), 'ali')
    await waitFor(() => expect(listAdminUsers).toHaveBeenLastCalledWith(
      expect.objectContaining({ q: 'ali' })))
  })
})

describe('UserDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getAdminUser.mockResolvedValue(detail())
    setUserDisabled.mockResolvedValue(undefined)
  })

  it('renders profile, stats, features, subjects and recent history', async () => {
    wrap(<UserDetailPage userId='u1' />)
    expect(await screen.findByText('累计正式作答题次')).toBeTruthy()
    expect(screen.getByText('800')).toBeTruthy()
    expect(screen.getByText('快速练习')).toBeTruthy()
    expect(screen.getByText('文法')).toBeTruthy()
    expect(screen.getByText('文法 · 接续')).toBeTruthy()
    expect(screen.getByText('75%')).toBeTruthy()
    expect(screen.getByText('4')).toBeTruthy()   // answered = correct + wrong
    expect(screen.getByTestId('line-chart')).toBeTruthy()
  })

  it('requires confirmation before disabling, then sends the reason', async () => {
    wrap(<UserDetailPage userId='u1' />)
    await userEvent.click(await screen.findByRole('button', { name: '禁用账号' }))
    expect(setUserDisabled).not.toHaveBeenCalled()
    await userEvent.type(screen.getByLabelText('操作原因'), '测试账号')
    await userEvent.click(screen.getByRole('button', { name: '确认禁用' }))
    await waitFor(() => expect(setUserDisabled).toHaveBeenCalledWith('u1', true, '测试账号'))
  })

  it('offers enabling for a disabled account and lists the audit trail', async () => {
    getAdminUser.mockResolvedValue(detail({
      user: { ...detail().user, account_state: 'disabled', disabled_at: '2026-11-17T01:00:00+00:00' },
      audit: [{ action: 'user_disable', admin_username: 'boss', reason: '垃圾账号',
        created_at: '2026-11-17T01:00:00+00:00' }],
    }))
    wrap(<UserDetailPage userId='u1' />)
    expect(await screen.findByRole('button', { name: '启用账号' })).toBeTruthy()
    expect(screen.getByText('禁用账号')).toBeTruthy()
    expect(screen.getByText(/boss/)).toBeTruthy()
  })
})
