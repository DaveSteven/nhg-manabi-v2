import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Alert, Button, Card, Col, Flex, Input, Row, Select, Statistic, Table, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { ArrowDownOutlined, ArrowUpOutlined } from '@ant-design/icons'
import {
  ACCOUNT_LABEL,
  ACTIVITY_LABEL,
  type AdminUser,
  type UserListQuery,
  listAdminUsers,
} from '@/lib/api'
import { formatDay, formatJst, formatJstDay } from './format'
import { AccountBadge, ActivityBadge, UserAvatar } from './user-badges'

const PAGE_SIZE = 20

const SORTS: { value: UserListQuery['sort']; label: string }[] = [
  { value: 'created_at', label: '按注册时间' },
  { value: 'last_learn_at', label: '按最近学习' },
  { value: 'answers_7d', label: '按近 7 天作答' },
]

function Metric({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <Card>
      <Statistic title={label} value={value} />
      <Typography.Text type='secondary' style={{ fontSize: 12 }}>
        {hint}
      </Typography.Text>
    </Card>
  )
}

const columns: ColumnsType<AdminUser> = [
  {
    title: '用户',
    render: (_, u) => (
      <Link to='/users/$userId' params={{ userId: u.id }}>
        <Flex align='center' gap={8}>
          <UserAvatar name={u.display_name} email={u.email} />
          <span style={{ minWidth: 0 }}>
            <span style={{ display: 'block', fontWeight: 500 }}>{u.display_name}</span>
            <Typography.Text type='secondary' style={{ fontSize: 12 }}>
              {u.email}
            </Typography.Text>
          </span>
        </Flex>
      </Link>
    ),
  },
  { title: '目标等级', dataIndex: 'current_level' },
  { title: '注册时间', render: (_, u) => formatJstDay(u.created_at) },
  { title: '最近访问', render: (_, u) => formatDay(u.last_visit_date) },
  { title: '最近学习', render: (_, u) => formatJst(u.last_learn_at) },
  { title: '近 7 天活跃', align: 'right', className: 'tabular', render: (_, u) => `${u.days_7d}/7 天` },
  {
    title: '近 7 天作答',
    align: 'right',
    className: 'tabular',
    render: (_, u) => new Intl.NumberFormat('zh-CN').format(u.answers_7d),
  },
  {
    title: '状态',
    render: (_, u) => (
      <Flex wrap gap={4}>
        <ActivityBadge activity={u.activity} />
        <AccountBadge state={u.account_state} />
      </Flex>
    ),
  },
]

const optionsOf = (labels: Record<string, string>, all: string) => [
  { value: '', label: all },
  ...Object.entries(labels).map(([value, label]) => ({ value, label })),
]

export function UsersPanel() {
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [filters, setFilters] = useState({ level: '', activity: '', account: '' })
  const [sort, setSort] = useState<UserListQuery['sort']>('created_at')
  const [order, setOrder] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(1)

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(search)
      setPage(1)
    }, 300)
    return () => clearTimeout(t)
  }, [search])

  const query: UserListQuery = { q, ...filters, sort, order, page, page_size: PAGE_SIZE }
  const list = useQuery({
    queryKey: ['admin-users', query],
    queryFn: () => listAdminUsers(query),
    placeholderData: (prev) => prev,
  })
  const data = list.data
  const setFilter = (k: keyof typeof filters, v: string) => {
    setFilters({ ...filters, [k]: v })
    setPage(1)
  }

  return (
    <Flex vertical gap={16}>
      {data && (
        <Row gutter={[16, 16]}>
          <Col xs={24} sm={8}>
            <Metric label='总用户数' value={data.summary.total_users} hint='已验证邮箱、未禁用的有效用户' />
          </Col>
          <Col xs={24} sm={8}>
            <Metric label='近 7 天学习活跃用户' value={data.summary.active_7d} hint='近 7 天至少一次有效正式作答' />
          </Col>
          <Col xs={24} sm={8}>
            <Metric label='尚未开始学习' value={data.summary.not_started} hint='注册后从未正式作答' />
          </Col>
        </Row>
      )}

      <Flex wrap gap={8} align='center'>
        <Input
          allowClear
          style={{ width: 260 }}
          aria-label='搜索用户'
          placeholder='搜索昵称或邮箱'
          value={search}
          maxLength={100}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select
          style={{ width: 120 }}
          aria-label='按目标等级筛选'
          value={filters.level}
          onChange={(v) => setFilter('level', v)}
          options={[
            { value: '', label: '全部等级' },
            ...['N1', 'N2', 'N3', 'N4', 'N5'].map((l) => ({ value: l, label: l })),
          ]}
        />
        <Select
          style={{ width: 140 }}
          aria-label='按活跃状态筛选'
          value={filters.activity}
          onChange={(v) => setFilter('activity', v)}
          options={optionsOf(ACTIVITY_LABEL, '全部活跃状态')}
        />
        <Select
          style={{ width: 140 }}
          aria-label='按账号状态筛选'
          value={filters.account}
          onChange={(v) => setFilter('account', v)}
          options={optionsOf(ACCOUNT_LABEL, '全部账号状态')}
        />
        <Select
          style={{ width: 150 }}
          aria-label='排序方式'
          value={sort}
          onChange={(v) => {
            setSort(v)
            setPage(1)
          }}
          options={SORTS}
        />
        <Button
          aria-label='切换排序方向'
          icon={order === 'desc' ? <ArrowDownOutlined /> : <ArrowUpOutlined />}
          onClick={() => {
            setOrder(order === 'desc' ? 'asc' : 'desc')
            setPage(1)
          }}
        >
          {order === 'desc' ? '降序' : '升序'}
        </Button>
      </Flex>

      {list.isError && (
        <Alert
          type='error'
          showIcon
          role='alert'
          message='无法加载用户列表，请确认服务已启动后重试。'
          action={
            <Button size='small' onClick={() => list.refetch()}>
              重试
            </Button>
          }
        />
      )}
      <Table<AdminUser>
        rowKey='id'
        loading={list.isPending || list.isFetching}
        columns={columns}
        dataSource={data?.items ?? []}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: '没有符合条件的用户。' }}
        pagination={{
          current: page,
          pageSize: PAGE_SIZE,
          total: data?.total ?? 0,
          showSizeChanger: false,
          showTotal: (total) => `共 ${new Intl.NumberFormat('zh-CN').format(total)} 人`,
          onChange: setPage,
        }}
      />
    </Flex>
  )
}

export function Users() {
  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          用户管理
        </Typography.Title>
        <Typography.Text type='secondary' style={{ fontSize: 12 }}>
          活跃以正式提交的有效作答为准；最近访问仅显示日期，无记录显示「—」；时间为日本时间。
        </Typography.Text>
      </div>
      <UsersPanel />
    </>
  )
}
