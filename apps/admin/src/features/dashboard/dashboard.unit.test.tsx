import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Dashboard as Data } from '@/lib/api'

const { getDashboard } = vi.hoisted(() => ({ getDashboard: vi.fn() }))
vi.mock('@/lib/api', async (orig) => ({
  ...(await orig<typeof import('@/lib/api')>()),
  getDashboard: (d: number) => getDashboard(d),
}))
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  LineChart: () => <div data-testid='line-chart' />,
  Line: () => null, XAxis: () => null, YAxis: () => null, Tooltip: () => null, CartesianGrid: () => null,
}))
vi.mock('@/components/layout/header', () => ({ Header: () => null }))
vi.mock('@/components/profile-dropdown', () => ({ ProfileDropdown: () => null }))
vi.mock('@/components/theme-switch', () => ({ ThemeSwitch: () => null }))

import { Dashboard } from './index'
import { pct } from './format'

const data = (over: Partial<Data> = {}): Data => ({
  range: { days: 7, start: '2026-11-12', end: '2026-11-18', timezone: 'Asia/Tokyo' },
  metrics: { registered_users: 120, active_learners: 30, new_users: 8, answered_questions: 1500 },
  daily: [{ date: '2026-11-18', learning: 5, visit: null }],
  visit_tracking: { available: false, note: '尚未采集访问事件。' },
  features: [{ key: 'quick', label: '快速练习', users: 20, starts: 40, completions: 30, completion_rate: 0.75 }],
  funnel: { visit_users: null, started_users: 25, completed_users: 20, start_to_complete_rate: 0.8, note: '分母说明' },
  alerts: [{ key: 'registered_not_started', label: '新注册后尚未开始学习', count: 3, scope: 'range' }],
  ...over,
})

function renderIt() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}><Dashboard /></QueryClientProvider>)
}

describe('Dashboard', () => {
  beforeEach(() => { vi.clearAllMocks(); getDashboard.mockResolvedValue(data()) })

  it('shows real metrics, honest visit-unavailable and funnel rate', async () => {
    renderIt()
    expect(await screen.findByText('1,500')).toBeTruthy()
    expect(screen.getByText(/访问活跃：暂不可用/)).toBeTruthy()
    expect(screen.getByText(/暂不可用（未采集访问事件）/)).toBeTruthy()
    expect(screen.getByText('20 人 · 80%')).toBeTruthy()
    expect(screen.getByText('75%')).toBeTruthy()
    expect(screen.getByTestId('line-chart')).toBeTruthy()
  })

  it('switches the range and refetches', async () => {
    renderIt()
    await screen.findByText('1,500')
    await userEvent.click(screen.getByRole('button', { name: '近 30 天' }))
    await waitFor(() => expect(getDashboard).toHaveBeenLastCalledWith(30))
  })

  it('empty trend and null rates are not faked', async () => {
    getDashboard.mockResolvedValue(data({
      daily: [{ date: '2026-11-18', learning: 0, visit: null }],
      features: [{ key: 'mock', label: '模拟考试', users: 0, starts: 0, completions: 0, completion_rate: null }],
      funnel: { visit_users: null, started_users: 0, completed_users: 0, start_to_complete_rate: null, note: 'n' },
    }))
    renderIt()
    expect(await screen.findByText(/暂无学习活跃数据/)).toBeTruthy()
    expect(screen.queryByTestId('line-chart')).toBeNull()
    expect(pct(null)).toBe('—')
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })

  it('shows a retryable error', async () => {
    getDashboard.mockRejectedValueOnce(new Error('x'))
    renderIt()
    expect((await screen.findByRole('alert')).textContent).toContain('无法加载统计数据')
  })
})
