import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Descriptions,
  Empty,
  Flex,
  Input,
  Modal,
  Row,
  Skeleton,
  Space,
  Statistic,
  Table,
  Timeline,
  Typography,
  theme,
} from 'antd'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { type UserDetail, describeUserActionError, getAdminUser, setUserDisabled } from '@/lib/api'
import { pct } from '@/features/dashboard/format'
import { formatDay, formatJst } from './format'
import { AccountBadge, ActivityBadge, UserAvatar } from './user-badges'

const KIND_LABEL: Record<string, string> = {
  quick: '快速练习',
  topic: '专项练习',
  mock: '模拟考试',
  exam: '试卷练习',
}
const ACTION_LABEL: Record<string, string> = { user_disable: '禁用账号', user_enable: '启用账号' }

type Recent = UserDetail['recent'][number]
type Feature = UserDetail['features'][number]

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <Card>
      <Statistic title={label} value={value} />
      {hint && (
        <Typography.Text type='secondary' style={{ fontSize: 12 }}>
          {hint}
        </Typography.Text>
      )}
    </Card>
  )
}

export function UserDetailView({ data, onToggle }: { data: UserDetail; onToggle: () => void }) {
  const { token } = theme.useToken()
  const u = data.user
  const s = data.stats
  const hasTrend = data.daily_30.some((d) => d.answers > 0)
  const disabled = u.account_state === 'disabled'
  return (
    <Flex vertical gap={16}>
      <Card>
        <Flex justify='space-between' align='flex-start' wrap gap={16} style={{ marginBottom: 16 }}>
          <Flex align='center' gap={12}>
            <UserAvatar name={u.display_name} email={u.email} size={48} />
            <div>
              <Space wrap>
                <Typography.Text strong style={{ fontSize: 18 }}>
                  {u.display_name}
                </Typography.Text>
                <ActivityBadge activity={u.activity} />
                <AccountBadge state={u.account_state} />
              </Space>
              <div>
                <Typography.Text type='secondary'>{u.email}</Typography.Text>
              </div>
            </div>
          </Flex>
          <Button type='primary' danger={!disabled} onClick={onToggle}>
            {disabled ? '启用账号' : '禁用账号'}
          </Button>
        </Flex>
        <Descriptions
          size='small'
          column={{ xs: 1, sm: 2, lg: 4 }}
          layout='vertical'
          items={[
            { key: 'id', label: '用户 ID', children: <span style={{ wordBreak: 'break-all' }}>{u.id}</span> },
            { key: 'lv', label: '目标 JLPT 等级', children: u.current_level },
            { key: 'c', label: '注册时间', children: formatJst(u.created_at) },
            { key: 'a', label: '邮箱验证时间', children: formatJst(u.activated_at) },
            { key: 'v', label: '最近访问', children: formatDay(u.last_visit_date) },
            { key: 'l', label: '最近学习', children: formatJst(u.last_learn_at) },
            {
              key: 's',
              label: '账号状态',
              children: disabled
                ? `已禁用（${formatJst(u.disabled_at)}）`
                : u.account_state === 'unverified'
                  ? '未验证邮箱'
                  : '正常',
            },
          ]}
        />
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} xl={6}>
          <Stat label='累计正式作答题次' value={s.total_answers} />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Stat label='累计完成练习次数' value={s.completed_sessions} />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Stat label='近 30 天活跃天数' value={s.active_days_30} hint='有正式作答的天数' />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Stat label='近 30 天作答题次' value={s.answers_30} />
        </Col>
      </Row>

      <Card title='近 30 天每日学习量'>
        {hasTrend ? (
          <div style={{ height: 224 }} data-testid='daily-chart'>
            <ResponsiveContainer width='100%' height='100%'>
              <LineChart data={data.daily_30}>
                <CartesianGrid strokeDasharray='3 3' vertical={false} stroke={token.colorBorderSecondary} />
                <XAxis dataKey='date' tickFormatter={(d: string) => d.slice(5)} fontSize={12} />
                <YAxis allowDecimals={false} width={32} fontSize={12} />
                <Tooltip formatter={(v) => [`${v} 题`, '作答']} labelFormatter={(l) => `${l}（日本时间）`} />
                <Line type='monotone' dataKey='answers' stroke={token.colorPrimary} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='近 30 天没有正式作答。' />
        )}
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card title='学习功能使用（累计）' styles={{ body: { paddingTop: 0 } }}>
            <Table<Feature>
              size='small'
              rowKey='key'
              pagination={false}
              dataSource={data.features}
              columns={[
                { title: '功能', dataIndex: 'label' },
                { title: '使用次数', dataIndex: 'starts', align: 'right', className: 'tabular' },
                { title: '完成次数', dataIndex: 'completions', align: 'right', className: 'tabular' },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title='主要练习科目（正式作答题次）' styles={{ body: { paddingTop: 0 } }}>
            <Table
              size='small'
              rowKey='subject'
              pagination={false}
              showHeader={false}
              dataSource={data.subjects}
              columns={[
                { dataIndex: 'label' },
                {
                  dataIndex: 'answers',
                  align: 'right',
                  className: 'tabular',
                  render: (v: number) => new Intl.NumberFormat('zh-CN').format(v),
                },
              ]}
            />
          </Card>
        </Col>
      </Row>

      <Card title='最近练习记录'>
        <Table<Recent>
          size='small'
          rowKey='session_id'
          pagination={false}
          dataSource={data.recent}
          locale={{ emptyText: '暂无练习记录。' }}
          columns={[
            { title: '类型', render: (_, r) => KIND_LABEL[r.source.kind] ?? r.source.kind },
            { title: '名称', render: (_, r) => r.source.label ?? '—' },
            { title: '完成时间', render: (_, r) => formatJst(r.happened_at) },
            { title: '作答题数', align: 'right', className: 'tabular', render: (_, r) => r.correct + r.wrong },
            { title: '正确率', align: 'right', className: 'tabular', render: (_, r) => pct(r.answered_accuracy) },
          ]}
        />
        <Typography.Paragraph type='secondary' style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
          作答题数与正确率只计有实际选择的正式答案；管理端只读，不可修改成绩。
        </Typography.Paragraph>
      </Card>

      <Card title='账号操作记录'>
        {data.audit.length === 0 ? (
          <Typography.Text type='secondary'>暂无操作记录。</Typography.Text>
        ) : (
          <Timeline
            items={data.audit.map((a, i) => ({
              key: i,
              color: a.action === 'user_disable' ? 'red' : 'green',
              content: (
                <>
                  <Typography.Text strong>{ACTION_LABEL[a.action] ?? a.action}</Typography.Text>
                  <Typography.Text type='secondary' style={{ marginLeft: 8 }}>
                    {a.admin_username} · {formatJst(a.created_at)}
                    {a.reason ? ` · ${a.reason}` : ''}
                  </Typography.Text>
                </>
              ),
            }))}
          />
        )}
      </Card>
    </Flex>
  )
}

export function UserDetailPage({ userId }: { userId: string }) {
  const qc = useQueryClient()
  const { message } = App.useApp()
  const query = useQuery({ queryKey: ['admin-user', userId], queryFn: () => getAdminUser(userId) })
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const disabled = query.data?.user.account_state === 'disabled'
  const action = useMutation({
    mutationFn: (disable: boolean) => setUserDisabled(userId, disable, reason),
    onSuccess: (_d, disable) => {
      message.success(disable ? '账号已禁用，已退出其所有登录。' : '账号已启用。')
      setOpen(false)
      setReason('')
    },
    onError: (e) => message.error(describeUserActionError(e)),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['admin-user', userId] })
      qc.invalidateQueries({ queryKey: ['admin-users'] })
    },
  })
  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <Link to='/users'>← 用户管理</Link>
        <Typography.Title level={3} style={{ margin: 0 }}>
          用户详情
        </Typography.Title>
        <Typography.Text type='secondary' style={{ fontSize: 12 }}>
          时间为日本时间；活跃口径与 Dashboard 一致。
        </Typography.Text>
      </div>
      {query.isPending && <Skeleton active paragraph={{ rows: 8 }} />}
      {query.isError && (
        <Alert
          type='error'
          showIcon
          role='alert'
          title='无法加载该用户（可能不存在或服务不可用）。'
          action={
            <Button size='small' onClick={() => query.refetch()}>
              重试
            </Button>
          }
        />
      )}
      {query.data && <UserDetailView data={query.data} onToggle={() => setOpen(true)} />}
      <Modal
        open={open}
        title={disabled ? '启用该账号？' : '禁用该账号？'}
        okText={disabled ? '确认启用' : '确认禁用'}
        cancelText='取消'
        okButtonProps={{ danger: !disabled }}
        confirmLoading={action.isPending}
        onCancel={() => setOpen(false)}
        onOk={() => action.mutate(!disabled)}
        destroyOnHidden
      >
        <Space orientation='vertical' style={{ width: '100%' }}>
          <Typography.Paragraph type='secondary'>
            {disabled
              ? '启用后用户可以重新登录，学习记录不受影响。'
              : '禁用后该用户会立即退出所有登录且无法再登录；学习记录全部保留，可随时启用。'}
          </Typography.Paragraph>
          <Input.TextArea
            aria-label='操作原因'
            placeholder='原因（选填，会记录在操作日志里）'
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
          />
        </Space>
      </Modal>
    </>
  )
}
