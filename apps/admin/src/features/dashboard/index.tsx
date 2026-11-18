import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { type Dashboard, getDashboard } from '@/lib/api'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { pct } from './format'


const nf = new Intl.NumberFormat('zh-CN')

function Metric({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <Card>
      <CardHeader className='pb-2'>
        <CardTitle className='text-sm font-medium text-muted-foreground'>{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className='text-3xl font-bold tabular-nums'>{nf.format(value)}</div>
        <p className='mt-1 text-xs text-muted-foreground'>{hint}</p>
      </CardContent>
    </Card>
  )
}

export function DashboardView({ data, days }: { data: Dashboard; days: 7 | 30 }) {
  const m = data.metrics
  const f = data.funnel
  const range = `近 ${days} 天`
  const vt = data.visit_tracking
  const hasData = data.daily.some((d) => d.learning > 0 || (d.visit ?? 0) > 0)
  return (
    <div className='space-y-4'>
      <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-4'>
        <Metric label='注册用户' value={m.registered_users} hint='累计有效注册（已验证邮箱）' />
        <Metric label='学习活跃用户' value={m.active_learners} hint={`${range}至少一次有效正式作答`} />
        <Metric label='新增用户' value={m.new_users} hint={`${range}新注册`} />
        <Metric label='正式作答题次' value={m.answered_questions} hint={`${range}正式提交且有选择`} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className='text-base'>每日活跃趋势</CardTitle>
          <p className='text-xs text-muted-foreground'>
            {vt.available ? vt.note : `访问活跃：暂不可用。${vt.note}`}
          </p>
        </CardHeader>
        <CardContent>
          {hasData ? (
            <div className='h-64' data-testid='trend-chart'>
              <ResponsiveContainer width='100%' height='100%'>
                <LineChart data={data.daily}>
                  <CartesianGrid strokeDasharray='3 3' vertical={false} />
                  <XAxis dataKey='date' tickFormatter={(d: string) => d.slice(5)} fontSize={12} />
                  <YAxis allowDecimals={false} width={32} fontSize={12} />
                  <Legend />
                  <Tooltip formatter={(v, name) => [`${v} 人`, name]} labelFormatter={(l) => `${l}（日本时间）`} />
                  {vt.available && (
                    <Line type='monotone' dataKey='visit' name='访问活跃' stroke='#94a3b8' strokeWidth={2} dot={false} connectNulls={false} />
                  )}
                  <Line type='monotone' dataKey='learning' name='学习活跃' stroke='#2563eb' strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className='py-10 text-center text-sm text-muted-foreground'>{range}暂无学习活跃数据。</p>
          )}
        </CardContent>
      </Card>

      <div className='grid gap-4 lg:grid-cols-2'>
        <Card>
          <CardHeader><CardTitle className='text-base'>学习功能使用</CardTitle></CardHeader>
          <CardContent>
            <table className='w-full text-sm'>
              <thead className='text-left text-xs text-muted-foreground'>
                <tr><th className='pb-2 font-normal'>功能</th><th className='pb-2 text-right font-normal'>使用人数</th>
                  <th className='pb-2 text-right font-normal'>开始</th><th className='pb-2 text-right font-normal'>完成</th>
                  <th className='pb-2 text-right font-normal'>完成率</th></tr>
              </thead>
              <tbody className='tabular-nums'>
                {data.features.map((x) => (
                  <tr key={x.key} className='border-t'>
                    <td className='py-2'>{x.label}</td>
                    <td className='py-2 text-right'>{x.users}</td>
                    <td className='py-2 text-right'>{x.starts}</td>
                    <td className='py-2 text-right'>{x.completions}</td>
                    <td className='py-2 text-right'>{pct(x.completion_rate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className='text-base'>学习转化漏斗</CardTitle></CardHeader>
          <CardContent className='space-y-2 text-sm'>
            <div className='flex justify-between'><span>访问网站</span>
              <span className='text-muted-foreground'>{f.visit_users === null ? '暂不可用（未采集访问事件）' : `${f.visit_users} 人`}</span></div>
            <div className='flex justify-between'><span>开始练习</span><span className='tabular-nums'>{f.started_users} 人{f.visit_to_start_rate !== null && ` · ${pct(f.visit_to_start_rate)}`}</span></div>
            <div className='flex justify-between'><span>完成练习</span><span className='tabular-nums'>{f.completed_users} 人 · {pct(f.start_to_complete_rate)}</span></div>
            <p className='pt-1 text-xs text-muted-foreground'>{f.note}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className='text-base'>运营提醒</CardTitle></CardHeader>
        <CardContent>
          <ul className='space-y-2 text-sm'>
            {data.alerts.map((a) => (
              <li key={a.key} className='flex justify-between'>
                <span>{a.label}<span className='ml-2 text-xs text-muted-foreground'>{a.scope === 'range' ? range : '当前'}</span></span>
                <span className='font-medium tabular-nums'>{a.count} 人</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}

export function Dashboard() {
  const [days, setDays] = useState<7 | 30>(7)
  const q = useQuery({ queryKey: ['admin-dashboard', days], queryFn: () => getDashboard(days) })
  return (
    <>
      <Header>
        <div className='ms-auto flex items-center space-x-4'>
          <ThemeSwitch />
          <ProfileDropdown />
        </div>
      </Header>
      <Main>
        <div className='mb-4 flex items-center justify-between'>
          <div>
            <h1 className='text-2xl font-bold tracking-tight'>Dashboard · 运营总览</h1>
            <p className='text-xs text-muted-foreground'>统计日期按日本时间（Asia/Tokyo）</p>
          </div>
          <div className='flex gap-1' role='group' aria-label='时间范围'>
            {([7, 30] as const).map((d) => (
              <Button key={d} size='sm' variant={days === d ? 'default' : 'outline'}
                aria-pressed={days === d} onClick={() => setDays(d)}>近 {d} 天</Button>
            ))}
          </div>
        </div>
        {q.isPending && <p className='text-sm text-muted-foreground'>加载中…</p>}
        {q.isError && (
          <p role='alert' className='text-sm text-destructive'>
            无法加载统计数据，请确认服务已启动后重试。
            <Button variant='link' size='sm' onClick={() => q.refetch()}>重试</Button>
          </p>
        )}
        {q.data && <DashboardView data={q.data} days={days} />}
      </Main>
    </>
  )
}
