import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AxiosError } from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdminExam } from '@/lib/api'

const { listAdminExams, withdrawRelease, restoreRelease } = vi.hoisted(() => ({
  listAdminExams: vi.fn(),
  withdrawRelease: vi.fn(),
  restoreRelease: vi.fn(),
}))
vi.mock('@/lib/api', async (orig) => ({
  ...(await orig<typeof import('@/lib/api')>()),
  listAdminExams: () => listAdminExams(),
  withdrawRelease: (...a: unknown[]) => withdrawRelease(...a),
  restoreRelease: (...a: unknown[]) => restoreRelease(...a),
}))

import { pickOption, renderApp } from '@/test-utils/render'
import { ExamsPanel } from './index'

const exam = (over: Partial<AdminExam> & { exam_id: string }): AdminExam => ({
  level: 'N2', year: 2018, month: 12, title: '2018年12月 N2', status: 'published',
  release: { id: `rel-${over.exam_id}`, revision: 3, state: 'published', is_current: true, published_at: '2026-11-16T10:00:00Z' },
  counts: { units: 88, hidden_units: 2, questions: 103, unverified_answer_keys: 103 },
  publication: { decision: 'auto_published', reviewer_id: 'system:auto-publish', note: {}, decided_at: '2026-11-16T10:00:00Z' },
  ...over,
})

function renderPanel() {
  return renderApp(<ExamsPanel />)
}

describe('ExamsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listAdminExams.mockResolvedValue([
      exam({ exam_id: 'A-N2' }),
      exam({ exam_id: 'B-N1', level: 'N1', title: '2019年7月 N1' }),
      exam({ exam_id: 'C-N3', level: 'N3', title: '2020年12月 N3', status: 'withdrawn',
        publication: { decision: 'withdrawn', reviewer_id: 'admin:1', note: '答案有误', decided_at: '2026-11-16T11:00:00Z' } }),
    ])
  })

  it('lists exams with status, hidden-unit and unverified counts and a summary', async () => {
    renderPanel()
    const row = await screen.findByTestId('row-A-N2')
    expect(within(row).getByText('已发布')).not.toBeNull()
    expect(within(row).getByText('86/88')).not.toBeNull()        // visible/total
    expect(within(row).getByText(/2 个隐藏/)).not.toBeNull()
    expect(within(row).getByText('自动发布')).not.toBeNull()
    expect(screen.getByText(/共 3 套 · 已发布 2 · 已下架 1/)).not.toBeNull()
    expect(screen.getByText(/原因：答案有误/)).not.toBeNull()
  })

  it('filters by level and by status', async () => {
    renderPanel()
    await screen.findByTestId('row-A-N2')
    await pickOption('按级别筛选', 'N1')
    await waitFor(() => expect(screen.queryByTestId('row-A-N2')).toBeNull())
    expect(screen.getByTestId('row-B-N1')).not.toBeNull()
    await pickOption('按级别筛选', '全部级别')
    await pickOption('按状态筛选', '已下架')
    expect(screen.queryByTestId('row-B-N1')).toBeNull()
    expect(screen.getByTestId('row-C-N3')).not.toBeNull()
  })

  it('withdraw: confirm dialog, sends the release id + reason, then refreshes the list', async () => {
    withdrawRelease.mockResolvedValue(undefined)
    renderPanel()
    const u = userEvent.setup()
    await screen.findByTestId('row-A-N2')
    await u.click(screen.getByRole('button', { name: '下架 2018年12月 N2' }))
    expect(withdrawRelease).not.toHaveBeenCalled()                // nothing until confirmed
    await u.type(await screen.findByLabelText('下架原因'), '答案键错误')
    await u.click(screen.getByRole('button', { name: '确认下架' }))
    await waitFor(() => expect(withdrawRelease).toHaveBeenCalledWith('rel-A-N2', '答案键错误'))
    expect(await screen.findByText('已下架，学生端不再显示。')).not.toBeNull()
    await waitFor(() => expect(listAdminExams).toHaveBeenCalledTimes(2))   // invalidated
  })

  it('cancel does not call the API', async () => {
    renderPanel()
    const u = userEvent.setup()
    await screen.findByTestId('row-A-N2')
    await u.click(screen.getByRole('button', { name: '下架 2018年12月 N2' }))
    await u.click(await screen.findByRole('button', { name: '取消' }))
    expect(withdrawRelease).not.toHaveBeenCalled()
  })

  it('restore: only offered for withdrawn exams and calls the API after confirmation', async () => {
    restoreRelease.mockResolvedValue(undefined)
    renderPanel()
    const u = userEvent.setup()
    await screen.findByTestId('row-C-N3')
    expect(screen.queryByRole('button', { name: '恢复上架 2018年12月 N2' })).toBeNull()
    await u.click(screen.getByRole('button', { name: '恢复上架 2020年12月 N3' }))
    const dialog = await screen.findByRole('dialog')
    await u.click(within(dialog).getByRole('button', { name: '恢复上架' }))
    await waitFor(() => expect(restoreRelease).toHaveBeenCalledWith('rel-C-N3'))
  })

  it('shows the server-specific message when the action is rejected', async () => {
    withdrawRelease.mockRejectedValue(new AxiosError('x', '409', undefined, undefined, {
      status: 409, data: { detail: { code: 'not_published' } } } as never))
    renderPanel()
    const u = userEvent.setup()
    await screen.findByTestId('row-A-N2')
    await u.click(screen.getByRole('button', { name: '下架 2018年12月 N2' }))
    await u.click(await screen.findByRole('button', { name: '确认下架' }))
    expect(await screen.findByText(/不是已发布状态/)).not.toBeNull()
  })

  it('shows an error state when the list cannot be loaded', async () => {
    listAdminExams.mockRejectedValue(new AxiosError('Network Error'))
    renderPanel()
    expect((await screen.findByRole('alert')).textContent).toContain('无法连接管理服务')
  })
})
