import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { toast } from 'sonner'
import { type UserDetail, describeUserActionError, getAdminUser, setUserDisabled } from '@/lib/api'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { pct } from '@/features/dashboard/format'
import { formatDay, formatJst } from './format'
import { AccountBadge, ActivityBadge, UserAvatar } from './user-badges'

const nf = new Intl.NumberFormat('zh-CN')
const KIND_LABEL: Record<string, string> = {
  quick: '快速练习', topic: '专项练习', mock: '模拟考试', exam: '试卷练习',
}
const ACTION_LABEL: Record<string, string> = { user_disable: '禁用账号', user_enable: '启用账号' }

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <Card>
      <CardHeader className='pb-1'>
        <CardTitle className='text-sm font-medium text-muted-foreground'>{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className='text-2xl font-bold tabular-nums'>{nf.format(value)}</div>
        {hint && <p className='mt-1 text-xs text-muted-foreground'>{hint}</p>}
      </CardContent>
    </Card>
  )
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className='text-xs text-muted-foreground'>{label}</dt>
      <dd className='break-all text-sm'>{children}</dd>
    </div>
  )
}

export function UserDetailView({ data, onToggle }: { data: UserDetail; onToggle: () => void }) {
  const u = data.user
  const s = data.stats
  const hasTrend = data.daily_30.some((d) => d.answers > 0)
  const disabled = u.account_state === 'disabled'
  return (
    <div className='space-y-4'>
      <Card>
        <CardContent className='flex flex-wrap items-start justify-between gap-4 pt-6'>
          <div className='flex items-center gap-3'>
            <UserAvatar name={u.display_name} email={u.email} />
            <div>
              <div className='flex flex-wrap items-center gap-2'>
                <span className='text-lg font-semibold'>{u.display_name}</span>
                <ActivityBadge activity={u.activity} />
                <AccountBadge state={u.account_state} />
              </div>
              <div className='text-sm text-muted-foreground'>{u.email}</div>
            </div>
          </div>
          <Button variant={disabled ? 'default' : 'destructive'} onClick={onToggle}>
            {disabled ? '启用账号' : '禁用账号'}
          </Button>
        </CardContent>
        <CardContent>
          <dl className='grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
            <Info label='用户 ID'>{u.id}</Info>
            <Info label='目标 JLPT 等级'>{u.current_level}</Info>
            <Info label='注册时间'>{formatJst(u.created_at)}</Info>
            <Info label='邮箱验证时间'>{formatJst(u.activated_at)}</Info>
            <Info label='最近访问'>{formatDay(u.last_visit_date)}</Info>
            <Info label='最近学习'>{formatJst(u.last_learn_at)}</Info>
            <Info label='账号状态'>
              {disabled ? `已禁用（${formatJst(u.disabled_at)}）` : u.account_state === 'unverified' ? '未验证邮箱' : '正常'}
            </Info>
          </dl>
        </CardContent>
      </Card>

      <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-4'>
        <Stat label='累计正式作答题次' value={s.total_answers} />
        <Stat label='累计完成练习次数' value={s.completed_sessions} />
        <Stat label='近 30 天活跃天数' value={s.active_days_30} hint='有正式作答的天数' />
        <Stat label='近 30 天作答题次' value={s.answers_30} />
      </div>

      <Card>
        <CardHeader><CardTitle className='text-base'>近 30 天每日学习量</CardTitle></CardHeader>
        <CardContent>
          {hasTrend ? (
            <div className='h-56' data-testid='daily-chart'>
              <ResponsiveContainer width='100%' height='100%'>
                <LineChart data={data.daily_30}>
                  <CartesianGrid strokeDasharray='3 3' vertical={false} />
                  <XAxis dataKey='date' tickFormatter={(d: string) => d.slice(5)} fontSize={12} />
                  <YAxis allowDecimals={false} width={32} fontSize={12} />
                  <Tooltip formatter={(v) => [`${v} 题`, '作答']} labelFormatter={(l) => `${l}（日本时间）`} />
                  <Line type='monotone' dataKey='answers' stroke='#2563eb' strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className='py-8 text-center text-sm text-muted-foreground'>近 30 天没有正式作答。</p>
          )}
        </CardContent>
      </Card>

      <div className='grid gap-4 lg:grid-cols-2'>
        <Card>
          <CardHeader><CardTitle className='text-base'>学习功能使用（累计）</CardTitle></CardHeader>
          <CardContent>
            <table className='w-full text-sm'>
              <thead className='text-left text-xs text-muted-foreground'>
                <tr><th className='pb-2 font-normal'>功能</th>
                  <th className='pb-2 text-right font-normal'>使用次数</th>
                  <th className='pb-2 text-right font-normal'>完成次数</th></tr>
              </thead>
              <tbody className='tabular-nums'>
                {data.features.map((f) => (
                  <tr key={f.key} className='border-t'>
                    <td className='py-2'>{f.label}</td>
                    <td className='py-2 text-right'>{f.starts}</td>
                    <td className='py-2 text-right'>{f.completions}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className='text-base'>主要练习科目（正式作答题次）</CardTitle></CardHeader>
          <CardContent>
            <ul className='space-y-2 text-sm'>
              {data.subjects.map((x) => (
                <li key={x.subject} className='flex justify-between'>
                  <span>{x.label}</span><span className='tabular-nums'>{nf.format(x.answers)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className='text-base'>最近练习记录</CardTitle></CardHeader>
        <CardContent>
          {data.recent.length === 0 ? (
            <p className='py-6 text-center text-sm text-muted-foreground'>暂无练习记录。</p>
          ) : (
            <table className='w-full text-sm'>
              <thead className='text-left text-xs text-muted-foreground'>
                <tr><th className='pb-2 font-normal'>类型</th><th className='pb-2 font-normal'>名称</th>
                  <th className='pb-2 font-normal'>完成时间</th>
                  <th className='pb-2 text-right font-normal'>作答题数</th>
                  <th className='pb-2 text-right font-normal'>正确率</th></tr>
              </thead>
              <tbody className='tabular-nums'>
                {data.recent.map((r) => (
                  <tr key={r.session_id} className='border-t'>
                    <td className='py-2'>{KIND_LABEL[r.source.kind] ?? r.source.kind}</td>
                    <td className='py-2'>{r.source.label ?? '—'}</td>
                    <td className='py-2 whitespace-nowrap'>{formatJst(r.happened_at)}</td>
                    <td className='py-2 text-right'>{r.correct + r.wrong}</td>
                    <td className='py-2 text-right'>{pct(r.answered_accuracy)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className='mt-2 text-xs text-muted-foreground'>
            作答题数与正确率只计有实际选择的正式答案；管理端只读，不可修改成绩。
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className='text-base'>账号操作记录</CardTitle></CardHeader>
        <CardContent>
          {data.audit.length === 0 ? (
            <p className='text-sm text-muted-foreground'>暂无操作记录。</p>
          ) : (
            <ul className='space-y-2 text-sm'>
              {data.audit.map((a, i) => (
                <li key={i}>
                  <span className='font-medium'>{ACTION_LABEL[a.action] ?? a.action}</span>
                  <span className='ml-2 text-muted-foreground'>
                    {a.admin_username} · {formatJst(a.created_at)}{a.reason ? ` · ${a.reason}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export function UserDetailPage({ userId }: { userId: string }) {
  const qc = useQueryClient()
  const query = useQuery({ queryKey: ['admin-user', userId], queryFn: () => getAdminUser(userId) })
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const disabled = query.data?.user.account_state === 'disabled'
  const action = useMutation({
    mutationFn: (disable: boolean) => setUserDisabled(userId, disable, reason),
    onSuccess: (_d, disable) => {
      toast.success(disable ? '账号已禁用，已退出其所有登录。' : '账号已启用。')
      setOpen(false)
      setReason('')
    },
    onError: (e) => toast.error(describeUserActionError(e)),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['admin-user', userId] })
      qc.invalidateQueries({ queryKey: ['admin-users'] })
    },
  })
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
          <Link to='/users' className='text-sm text-muted-foreground hover:underline'>← 用户管理</Link>
          <h1 className='text-2xl font-bold tracking-tight'>用户详情</h1>
          <p className='text-xs text-muted-foreground'>时间为日本时间；活跃口径与 Dashboard 一致。</p>
        </div>
        {query.isPending && <p className='text-sm text-muted-foreground'>加载中…</p>}
        {query.isError && (
          <p role='alert' className='text-sm text-destructive'>
            无法加载该用户（可能不存在或服务不可用）。
            <Button variant='link' size='sm' onClick={() => query.refetch()}>重试</Button>
          </p>
        )}
        {query.data && <UserDetailView data={query.data} onToggle={() => setOpen(true)} />}
        <ConfirmDialog
          open={open}
          onOpenChange={(o) => !o && setOpen(false)}
          title={disabled ? '启用该账号？' : '禁用该账号？'}
          desc={disabled
            ? '启用后用户可以重新登录，学习记录不受影响。'
            : '禁用后该用户会立即退出所有登录且无法再登录；学习记录全部保留，可随时启用。'}
          confirmText={disabled ? '确认启用' : '确认禁用'}
          cancelBtnText='取消'
          destructive={!disabled}
          isLoading={action.isPending}
          handleConfirm={() => action.mutate(!disabled)}
        >
          <Textarea aria-label='操作原因' placeholder='原因（选填，会记录在操作日志里）'
            value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
        </ConfirmDialog>
      </Main>
    </>
  )
}
