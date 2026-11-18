import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  ACCOUNT_LABEL, ACTIVITY_LABEL, type UserListQuery, listAdminUsers,
} from '@/lib/api'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { formatDay, formatJst, formatJstDay } from './format'
import { AccountBadge, ActivityBadge, UserAvatar } from './user-badges'

const selectClass = 'h-9 rounded-md border border-input bg-background px-3 text-sm shadow-xs'
const nf = new Intl.NumberFormat('zh-CN')
const PAGE_SIZE = 20

const SORTS: { value: UserListQuery['sort']; label: string }[] = [
  { value: 'created_at', label: '按注册时间' },
  { value: 'last_learn_at', label: '按最近学习' },
  { value: 'answers_7d', label: '按近 7 天作答' },
]

function Metric({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <Card>
      <CardHeader className='pb-1'>
        <CardTitle className='text-sm font-medium text-muted-foreground'>{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className='text-2xl font-bold tabular-nums'>{nf.format(value)}</div>
        <p className='mt-1 text-xs text-muted-foreground'>{hint}</p>
      </CardContent>
    </Card>
  )
}

export function UsersPanel() {
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [filters, setFilters] = useState({ level: '', activity: '', account: '' })
  const [sort, setSort] = useState<UserListQuery['sort']>('created_at')
  const [order, setOrder] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(1)

  useEffect(() => {
    const t = setTimeout(() => { setQ(search); setPage(1) }, 300)
    return () => clearTimeout(t)
  }, [search])

  const query: UserListQuery = { q, ...filters, sort, order, page, page_size: PAGE_SIZE }
  const list = useQuery({
    queryKey: ['admin-users', query],
    queryFn: () => listAdminUsers(query),
    placeholderData: (prev) => prev,
  })
  const data = list.data
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1
  const setFilter = (k: keyof typeof filters, v: string) => {
    setFilters({ ...filters, [k]: v })
    setPage(1)
  }

  return (
    <div className='space-y-4'>
      {data && (
        <div className='grid gap-4 sm:grid-cols-3'>
          <Metric label='总用户数' value={data.summary.total_users} hint='已验证邮箱、未禁用的有效用户' />
          <Metric label='近 7 天学习活跃用户' value={data.summary.active_7d} hint='近 7 天至少一次有效正式作答' />
          <Metric label='尚未开始学习' value={data.summary.not_started} hint='注册后从未正式作答' />
        </div>
      )}

      <div className='flex flex-wrap items-center gap-2'>
        <Input className='h-9 w-64' aria-label='搜索用户' placeholder='搜索昵称或邮箱'
          value={search} onChange={(e) => setSearch(e.target.value)} maxLength={100} />
        <select className={selectClass} aria-label='按目标等级筛选' value={filters.level}
          onChange={(e) => setFilter('level', e.target.value)}>
          <option value=''>全部等级</option>
          {['N1', 'N2', 'N3', 'N4', 'N5'].map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <select className={selectClass} aria-label='按活跃状态筛选' value={filters.activity}
          onChange={(e) => setFilter('activity', e.target.value)}>
          <option value=''>全部活跃状态</option>
          {Object.entries(ACTIVITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className={selectClass} aria-label='按账号状态筛选' value={filters.account}
          onChange={(e) => setFilter('account', e.target.value)}>
          <option value=''>全部账号状态</option>
          {Object.entries(ACCOUNT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className={selectClass} aria-label='排序方式' value={sort}
          onChange={(e) => { setSort(e.target.value as UserListQuery['sort']); setPage(1) }}>
          {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <Button variant='outline' size='sm' aria-label='切换排序方向'
          onClick={() => { setOrder(order === 'desc' ? 'asc' : 'desc'); setPage(1) }}>
          {order === 'desc' ? '降序 ↓' : '升序 ↑'}
        </Button>
      </div>

      {list.isPending && <p className='text-sm text-muted-foreground'>加载中…</p>}
      {list.isError && (
        <p role='alert' className='text-sm text-destructive'>
          无法加载用户列表，请确认服务已启动后重试。
          <Button variant='link' size='sm' onClick={() => list.refetch()}>重试</Button>
        </p>
      )}
      {data && data.items.length === 0 && (
        <p className='py-10 text-center text-sm text-muted-foreground' role='status'>没有符合条件的用户。</p>
      )}
      {data && data.items.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>用户</TableHead>
              <TableHead>目标等级</TableHead>
              <TableHead>注册时间</TableHead>
              <TableHead>最近访问</TableHead>
              <TableHead>最近学习</TableHead>
              <TableHead className='text-end'>近 7 天活跃</TableHead>
              <TableHead className='text-end'>近 7 天作答</TableHead>
              <TableHead>状态</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.items.map((u) => (
              <TableRow key={u.id}>
                <TableCell>
                  <Link to='/users/$userId' params={{ userId: u.id }} className='flex items-center gap-2 hover:underline'>
                    <UserAvatar name={u.display_name} email={u.email} />
                    <span className='min-w-0'>
                      <span className='block truncate font-medium'>{u.display_name}</span>
                      <span className='block truncate text-xs text-muted-foreground'>{u.email}</span>
                    </span>
                  </Link>
                </TableCell>
                <TableCell>{u.current_level}</TableCell>
                <TableCell className='whitespace-nowrap text-sm'>{formatJstDay(u.created_at)}</TableCell>
                <TableCell className='whitespace-nowrap text-sm'>{formatDay(u.last_visit_date)}</TableCell>
                <TableCell className='whitespace-nowrap text-sm'>{formatJst(u.last_learn_at)}</TableCell>
                <TableCell className='text-end tabular-nums'>{u.days_7d}/7 天</TableCell>
                <TableCell className='text-end tabular-nums'>{nf.format(u.answers_7d)}</TableCell>
                <TableCell>
                  <span className='flex flex-wrap items-center gap-1'>
                    <ActivityBadge activity={u.activity} />
                    <AccountBadge state={u.account_state} />
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {data && data.total > 0 && (
        <div className='flex items-center justify-between text-sm text-muted-foreground'>
          <span>共 {nf.format(data.total)} 人 · 第 {data.page} / {pages} 页</span>
          <div className='flex gap-2'>
            <Button variant='outline' size='sm' disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</Button>
            <Button variant='outline' size='sm' disabled={page >= pages} onClick={() => setPage(page + 1)}>下一页</Button>
          </div>
        </div>
      )}
    </div>
  )
}

export function Users() {
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
          <h1 className='text-2xl font-bold tracking-tight'>用户管理</h1>
          <p className='text-xs text-muted-foreground'>
            活跃以正式提交的有效作答为准；最近访问仅显示日期，无记录显示「—」；时间为日本时间。
          </p>
        </div>
        <UsersPanel />
      </Main>
    </>
  )
}
