import { screen, waitFor } from '@testing-library/react'
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
  Line: () => null, Legend: () => null, XAxis: () => null, YAxis: () => null, Tooltip: () => null, CartesianGrid: () => null,
}))

import { renderApp } from '@/test-utils/render'
import { Dashboard } from './index'
import { pct } from './format'

const data = (over: Partial<Data> = {}): Data => ({
  range: { days: 7, start: '2026-11-12', end: '2026-11-18', timezone: 'Asia/Tokyo' },
  metrics: { registered_users: 120, active_learners: 30, new_users: 8, answered_questions: 1500 },
  daily: [{ date: '2026-11-18', learning: 5, visit: null }],
  visit_tracking: { available: false, since: null, note: '尚未采集访问事件。' },
  features: [{ key: 'quick', label: '快速练习', users: 20, starts: 40, completions: 30, completion_rate: 0.75 }],
  funnel: { visit_users: null, started_users: 25, completed_users: 20, visit_to_start_rate: null, start_to_complete_rate: 0.8, note: '分母说明' },
  alerts: [{ key: 'registered_not_started', label: '新注册后尚未开始学习', count: 3, scope: 'range' }],
  ...over,
})

function renderIt() {
  return renderApp(<Dashboard />)
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

  it('shows visit stage and conversion once tracking exists', async () => {
    getDashboard.mockResolvedValue(data({
      visit_tracking: { available: true, since: '2026-11-18', note: '访问数据自 2026-11-18 起采集' },
      daily: [{ date: '2026-11-18', learning: 5, visit: 9 }],
      funnel: { visit_users: 50, started_users: 25, completed_users: 20,
        visit_to_start_rate: 0.5, start_to_complete_rate: 0.8, note: 'n' },
    }))
    renderIt()
    expect(await screen.findByText('50 人')).toBeTruthy()
    expect(screen.getByText('25 人 · 50%')).toBeTruthy()
    expect(screen.getByText(/访问数据自 2026-11-18 起采集/)).toBeTruthy()
    expect(screen.queryByText(/访问活跃：暂不可用/)).toBeNull()
  })

  it('switches the range and refetches', async () => {
    renderIt()
    await screen.findByText('1,500')
    await userEvent.click(screen.getByText('近 30 天'))
    await waitFor(() => expect(getDashboard).toHaveBeenLastCalledWith(30))
  })

  it('empty trend and null rates are not faked', async () => {
    getDashboard.mockResolvedValue(data({
      daily: [{ date: '2026-11-18', learning: 0, visit: null }],
      features: [{ key: 'mock', label: '模拟考试', users: 0, starts: 0, completions: 0, completion_rate: null }],
      funnel: { visit_users: null, started_users: 0, completed_users: 0, visit_to_start_rate: null, start_to_complete_rate: null, note: 'n' },
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
