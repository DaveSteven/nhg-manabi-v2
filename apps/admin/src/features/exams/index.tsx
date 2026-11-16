import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  type AdminExam,
  describeReleaseError,
  listAdminExams,
  restoreRelease,
  withdrawRelease,
} from '@/lib/api'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ExamsTable } from './exams-table'
import { type ExamFilters, examLabel, filterExams, summarize } from './filter'

const LEVELS = ['N1', 'N2', 'N3', 'N4', 'N5']
const selectClass =
  'h-9 rounded-md border border-input bg-background px-3 text-sm shadow-xs'

/** Query + actions around the table; exported separately for tests. */
export function ExamsPanel() {
  const qc = useQueryClient()
  const query = useQuery({ queryKey: ['admin-exams'], queryFn: listAdminExams })
  const [filters, setFilters] = useState<ExamFilters>({ q: '', level: '', status: '' })
  // The target stays set while the dialog animates closed (title must not blank).
  const [target, setTarget] = useState<AdminExam | null>(null)
  const [mode, setMode] = useState<'withdraw' | 'restore' | null>(null)
  const withdrawing = mode === 'withdraw' ? target : null
  const restoring = mode === 'restore' ? target : null
  const [reason, setReason] = useState('')

  const exams = useMemo(() => query.data ?? [], [query.data])
  const shown = useMemo(() => filterExams(exams, filters), [exams, filters])
  const sum = useMemo(() => summarize(exams), [exams])

  const withdraw = useMutation({
    mutationFn: (v: { id: string; reason: string }) => withdrawRelease(v.id, v.reason),
    onSuccess: () => {
      toast.success('已下架，学生端不再显示。')
      setMode(null)
      setReason('')
    },
    onError: (e) => toast.error(describeReleaseError(e)),
    onSettled: () => qc.invalidateQueries({ queryKey: ['admin-exams'] }),
  })
  const restore = useMutation({
    mutationFn: (id: string) => restoreRelease(id),
    onSuccess: () => {
      toast.success('已恢复上架。')
      setMode(null)
    },
    onError: (e) => toast.error(describeReleaseError(e)),
    onSettled: () => qc.invalidateQueries({ queryKey: ['admin-exams'] }),
  })
  const busy = withdraw.isPending
    ? (target?.release?.id ?? null)
    : restore.isPending
      ? (target?.release?.id ?? null)
      : null

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-center gap-2'>
        <Input
          className='h-9 w-56'
          placeholder='搜索试卷（年份、月份、编号）'
          aria-label='搜索试卷'
          value={filters.q}
          onChange={(e) => setFilters({ ...filters, q: e.target.value })}
        />
        <select
          className={selectClass}
          aria-label='按级别筛选'
          value={filters.level}
          onChange={(e) => setFilters({ ...filters, level: e.target.value })}
        >
          <option value=''>全部级别</option>
          {LEVELS.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
        <select
          className={selectClass}
          aria-label='按状态筛选'
          value={filters.status}
          onChange={(e) => setFilters({ ...filters, status: e.target.value })}
        >
          <option value=''>全部状态</option>
          <option value='published'>已发布</option>
          <option value='withdrawn'>已下架</option>
          <option value='unpublished'>未发布</option>
        </select>
        <p className='ms-auto text-sm text-muted-foreground' aria-live='polite'>
          共 {sum.total} 套 · 已发布 {sum.published} · 已下架 {sum.withdrawn} ·
          已发布中未验证答案 {sum.unverifiedKeys.toLocaleString('zh-CN')} 个
        </p>
      </div>

      {query.isPending ? (
        <p role='status' className='py-10 text-center text-sm text-muted-foreground'>
          加载中…
        </p>
      ) : query.isError ? (
        <p role='alert' className='py-10 text-center text-sm text-destructive'>
          {describeReleaseError(query.error)}
        </p>
      ) : (
        <ExamsTable
          exams={shown}
          busyReleaseId={busy}
          onWithdraw={(e) => {
            setReason('')
            setTarget(e)
            setMode('withdraw')
          }}
          onRestore={(e) => {
            setTarget(e)
            setMode('restore')
          }}
        />
      )}

      <ConfirmDialog
        open={mode === 'withdraw'}
        onOpenChange={(o) => !o && setMode(null)}
        title={target ? `下架 ${examLabel(target)}？` : ''}
        desc='下架后学生端立刻看不到这套试卷，也无法继续或新建练习；学生已有的作答记录保留。可随时恢复上架。'
        confirmText='确认下架'
        cancelBtnText='取消'
        destructive
        isLoading={withdraw.isPending}
        handleConfirm={() =>
          withdrawing?.release &&
          withdraw.mutate({ id: withdrawing.release.id, reason })
        }
      >
        <Textarea
          aria-label='下架原因'
          placeholder='下架原因（选填，会记录在操作历史里）'
          value={reason}
          maxLength={500}
          onChange={(e) => setReason(e.target.value)}
        />
      </ConfirmDialog>

      <ConfirmDialog
        open={mode === 'restore'}
        onOpenChange={(o) => !o && setMode(null)}
        title={target ? `恢复上架 ${examLabel(target)}？` : ''}
        desc='恢复后学生端将重新显示这套试卷（沿用下架前的版本）。'
        confirmText='恢复上架'
        cancelBtnText='取消'
        isLoading={restore.isPending}
        handleConfirm={() => restoring?.release && restore.mutate(restoring.release.id)}
      />
    </div>
  )
}

export function Exams() {
  return (
    <>
      <Header>
        <div className='ms-auto flex items-center space-x-4'>
          <ThemeSwitch />
          <ProfileDropdown />
        </div>
      </Header>
      <Main>
        <div className='mb-4'>
          <h1 className='text-2xl font-bold tracking-tight'>试卷管理</h1>
          <p className='text-muted-foreground'>
            入库后默认直接发布；这里可以随时下架或恢复。
          </p>
        </div>
        <ExamsPanel />
      </Main>
    </>
  )
}
