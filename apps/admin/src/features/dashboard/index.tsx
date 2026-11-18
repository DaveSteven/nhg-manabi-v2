import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Flex,
  Row,
  Segmented,
  Skeleton,
  Statistic,
  Table,
  Typography,
  theme,
} from 'antd'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { type Dashboard as DashboardData, getDashboard } from '@/lib/api'
import { pct } from './format'

type Feature = DashboardData['features'][number]

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

function FunnelRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Flex justify='space-between' style={{ padding: '6px 0' }}>
      <span>{label}</span>
      <span className='tabular'>{children}</span>
    </Flex>
  )
}

export function DashboardView({ data, days }: { data: DashboardData; days: 7 | 30 }) {
  const { token } = theme.useToken()
  const m = data.metrics
  const f = data.funnel
  const range = `近 ${days} 天`
  const vt = data.visit_tracking
  const hasData = data.daily.some((d) => d.learning > 0 || (d.visit ?? 0) > 0)

  return (
    <Flex vertical gap={16}>
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} xl={6}>
          <Metric label='注册用户' value={m.registered_users} hint='累计有效注册（已验证邮箱）' />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Metric
            label='学习活跃用户'
            value={m.active_learners}
            hint={`${range}至少一次有效正式作答`}
          />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Metric label='新增用户' value={m.new_users} hint={`${range}新注册`} />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Metric
            label='正式作答题次'
            value={m.answered_questions}
            hint={`${range}正式提交且有选择`}
          />
        </Col>
      </Row>

      <Card title='每日活跃趋势'>
        <Typography.Paragraph type='secondary' style={{ fontSize: 12 }}>
          {vt.available ? vt.note : `访问活跃：暂不可用。${vt.note}`}
        </Typography.Paragraph>
        {hasData ? (
          <div style={{ height: 256 }} data-testid='trend-chart'>
            <ResponsiveContainer width='100%' height='100%'>
              <LineChart data={data.daily}>
                <CartesianGrid strokeDasharray='3 3' vertical={false} stroke={token.colorBorderSecondary} />
                <XAxis dataKey='date' tickFormatter={(d: string) => d.slice(5)} fontSize={12} />
                <YAxis allowDecimals={false} width={32} fontSize={12} />
                <Legend />
                <Tooltip
                  formatter={(v, name) => [`${v} 人`, name]}
                  labelFormatter={(l) => `${l}（日本时间）`}
                />
                {vt.available && (
                  <Line
                    type='monotone'
                    dataKey='visit'
                    name='访问活跃'
                    stroke='#94a3b8'
                    strokeWidth={2}
                    dot={false}
                    connectNulls={false}
                  />
                )}
                <Line
                  type='monotone'
                  dataKey='learning'
                  name='学习活跃'
                  stroke={token.colorPrimary}
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={`${range}暂无学习活跃数据。`} />
        )}
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card title='学习功能使用' styles={{ body: { paddingTop: 0 } }}>
            <Table<Feature>
              size='small'
              pagination={false}
              rowKey='key'
              dataSource={data.features}
              columns={[
                { title: '功能', dataIndex: 'label' },
                { title: '使用人数', dataIndex: 'users', align: 'right', className: 'tabular' },
                { title: '开始', dataIndex: 'starts', align: 'right', className: 'tabular' },
                { title: '完成', dataIndex: 'completions', align: 'right', className: 'tabular' },
                {
                  title: '完成率',
                  dataIndex: 'completion_rate',
                  align: 'right',
                  className: 'tabular',
                  render: (v: number | null) => pct(v),
                },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title='学习转化漏斗'>
            <FunnelRow label='访问网站'>
              <Typography.Text type='secondary'>
                {f.visit_users === null ? '暂不可用（未采集访问事件）' : `${f.visit_users} 人`}
              </Typography.Text>
            </FunnelRow>
            <FunnelRow label='开始练习'>
              {f.started_users} 人{f.visit_to_start_rate !== null && ` · ${pct(f.visit_to_start_rate)}`}
            </FunnelRow>
            <FunnelRow label='完成练习'>
              {f.completed_users} 人 · {pct(f.start_to_complete_rate)}
            </FunnelRow>
            <Typography.Text type='secondary' style={{ fontSize: 12 }}>
              {f.note}
            </Typography.Text>
          </Card>
        </Col>
      </Row>

      <Card title='运营提醒'>
        <Flex vertical>
          {data.alerts.map((a) => (
            <Flex
              key={a.key}
              justify='space-between'
              style={{ padding: '8px 0', borderBottom: `1px solid ${token.colorBorderSecondary}` }}
            >
              <span>
                {a.label}
                <Typography.Text type='secondary' style={{ marginLeft: 8, fontSize: 12 }}>
                  {a.scope === 'range' ? range : '当前'}
                </Typography.Text>
              </span>
              <Typography.Text strong className='tabular'>
                {a.count} 人
              </Typography.Text>
            </Flex>
          ))}
        </Flex>
      </Card>
    </Flex>
  )
}

export function Dashboard() {
  const [days, setDays] = useState<7 | 30>(7)
  const q = useQuery({ queryKey: ['admin-dashboard', days], queryFn: () => getDashboard(days) })
  return (
    <>
      <Flex justify='space-between' align='flex-start' wrap gap={12} style={{ marginBottom: 16 }}>
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>
            Dashboard · 运营总览
          </Typography.Title>
          <Typography.Text type='secondary' style={{ fontSize: 12 }}>
            统计日期按日本时间（Asia/Tokyo）
          </Typography.Text>
        </div>
        <Segmented<7 | 30>
          aria-label='时间范围'
          value={days}
          onChange={setDays}
          options={[
            { value: 7, label: '近 7 天' },
            { value: 30, label: '近 30 天' },
          ]}
        />
      </Flex>
      {q.isPending && <Skeleton active paragraph={{ rows: 8 }} />}
      {q.isError && (
        <Alert
          type='error'
          showIcon
          role='alert'
          message='无法加载统计数据，请确认服务已启动后重试。'
          action={
            <Button size='small' onClick={() => q.refetch()}>
              重试
            </Button>
          }
        />
      )}
      {q.data && <DashboardView data={q.data} days={days} />}
    </>
  )
}
