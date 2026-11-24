import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  App,
  Button,
  Flex,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  type AdminExam,
  describeReleaseError,
  exportReleaseDocx,
  listAdminExams,
  restoreRelease,
  withdrawRelease,
} from '@/lib/api'
import { DECISION_LABEL, type ExamFilters, examLabel, filterExams, formatTime, summarize } from './filter'

const LEVELS = ['N1', 'N2', 'N3', 'N4', 'N5']

const STATUS: Record<AdminExam['status'], { label: string; color: string }> = {
  published: { label: '已发布', color: 'green' },
  withdrawn: { label: '已下架', color: 'default' },
  unpublished: { label: '未发布', color: 'orange' },
}

/** Query + actions around the table; exported separately for tests. */
export function ExamsPanel() {
  const qc = useQueryClient()
  const { message } = App.useApp()
  const query = useQuery({ queryKey: ['admin-exams'], queryFn: listAdminExams })
  const [filters, setFilters] = useState<ExamFilters>({ q: '', level: '', status: '' })
  // The target stays set while the dialog animates closed (title must not blank).
  const [target, setTarget] = useState<AdminExam | null>(null)
  const [mode, setMode] = useState<'withdraw' | 'restore' | null>(null)
  const [reason, setReason] = useState('')

  const exams = useMemo(() => query.data ?? [], [query.data])
  const shown = useMemo(() => filterExams(exams, filters), [exams, filters])
  const sum = useMemo(() => summarize(exams), [exams])

  const withdraw = useMutation({
    mutationFn: (v: { id: string; reason: string }) => withdrawRelease(v.id, v.reason),
    onSuccess: () => {
      message.success('已下架，学生端不再显示。')
      setMode(null)
      setReason('')
    },
    onError: (e) => message.error(describeReleaseError(e)),
    onSettled: () => qc.invalidateQueries({ queryKey: ['admin-exams'] }),
  })
  const restore = useMutation({
    mutationFn: (id: string) => restoreRelease(id),
    onSuccess: () => {
      message.success('已恢复上架。')
      setMode(null)
    },
    onError: (e) => message.error(describeReleaseError(e)),
    onSettled: () => qc.invalidateQueries({ queryKey: ['admin-exams'] }),
  })
  const [exporting, setExporting] = useState<string | null>(null)
  const exportDocx = async (e: AdminExam, kind: 'paper' | 'answers') => {
    const rid = e.release?.id
    if (!rid) return
    setExporting(`${rid}:${kind}`)
    try {
      await exportReleaseDocx(rid, kind, `${e.exam_id}-${kind === 'paper' ? '试题' : '答案与解析'}.docx`)
    } catch (err) {
      message.error(describeReleaseError(err))
    } finally {
      setExporting(null)
    }
  }
  const busyId = withdraw.isPending || restore.isPending ? (target?.release?.id ?? null) : null

  const columns: ColumnsType<AdminExam> = [
    { title: '级别', dataIndex: 'level', width: 72, render: (v: string) => <strong>{v}</strong> },
    {
      title: '试卷',
      render: (_, e) => (
        <>
          <div>{examLabel(e)}</div>
          <Typography.Text type='secondary' style={{ fontSize: 12 }}>
            {e.exam_id}
          </Typography.Text>
        </>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      render: (s: AdminExam['status']) => <Tag color={STATUS[s].color}>{STATUS[s].label}</Tag>,
    },
    {
      title: '版本',
      align: 'right',
      className: 'tabular',
      render: (_, e) => (e.release ? `r${e.release.revision}` : '—'),
    },
    {
      title: 'Unit（可见/总数）',
      align: 'right',
      className: 'tabular',
      render: (_, e) => (
        <>
          {e.counts.units - e.counts.hidden_units}/{e.counts.units}
          {e.counts.hidden_units > 0 ? (
            <Typography.Text type='secondary' style={{ fontSize: 12, marginLeft: 4 }} title='待确认的 Unit 不会对学生显示'>
              （{e.counts.hidden_units} 个隐藏）
            </Typography.Text>
          ) : null}
        </>
      ),
    },
    { title: '题数', align: 'right', className: 'tabular', render: (_, e) => e.counts.questions },
    {
      title: '未验证答案',
      align: 'right',
      className: 'tabular',
      render: (_, e) => e.counts.unverified_answer_keys,
    },
    {
      title: '最近操作',
      width: 220,
      render: (_, e) => {
        if (!e.publication) return '—'
        const reasonText =
          e.publication.decision === 'withdrawn' && typeof e.publication.note === 'string'
            ? e.publication.note
            : null
        return (
          <>
            <div>{DECISION_LABEL[e.publication.decision] ?? e.publication.decision}</div>
            <Typography.Text type='secondary' style={{ fontSize: 12 }}>
              {formatTime(e.publication.decided_at)}
            </Typography.Text>
            {reasonText ? (
              <div>
                <Typography.Text type='secondary' style={{ fontSize: 12 }}>
                  原因：{reasonText}
                </Typography.Text>
              </div>
            ) : null}
          </>
        )
      },
    },
    {
      title: '操作',
      align: 'right',
      render: (_, e) => {
        const rid = e.release?.id ?? null
        const busy = rid !== null && busyId === rid
        let action: React.ReactNode = null
        if (e.status === 'published' && rid) {
          action = (
            <Button
              size='small'
              disabled={busy}
              aria-label={`下架 ${examLabel(e)}`}
              onClick={() => {
                setReason('')
                setTarget(e)
                setMode('withdraw')
              }}
            >
              下架
            </Button>
          )
        } else if (e.status === 'withdrawn' && rid) {
          action = (
            <Button
              size='small'
              disabled={busy}
              aria-label={`恢复上架 ${examLabel(e)}`}
              onClick={() => {
                setTarget(e)
                setMode('restore')
              }}
            >
              恢复上架
            </Button>
          )
        }
        if (!rid) return <Typography.Text type='secondary'>—</Typography.Text>
        return (
          <Space size={8}>
            <Button
              size='small'
              loading={exporting === `${rid}:paper`}
              aria-label={`导出试题 Word ${examLabel(e)}`}
              onClick={() => void exportDocx(e, 'paper')}
            >
              导出试题
            </Button>
            <Button
              size='small'
              loading={exporting === `${rid}:answers`}
              aria-label={`导出答案解析 Word ${examLabel(e)}`}
              onClick={() => void exportDocx(e, 'answers')}
            >
              导出答案解析
            </Button>
            {action}
          </Space>
        )
      },
    },
  ]

  return (
    <Flex vertical gap={16}>
      <Flex wrap gap={8} align='center'>
        <Input.Search
          allowClear
          style={{ width: 260 }}
          placeholder='搜索试卷（年份、月份、编号）'
          aria-label='搜索试卷'
          value={filters.q}
          onChange={(e) => setFilters({ ...filters, q: e.target.value })}
        />
        <Select
          style={{ width: 120 }}
          aria-label='按级别筛选'
          value={filters.level}
          onChange={(level) => setFilters({ ...filters, level })}
          options={[{ value: '', label: '全部级别' }, ...LEVELS.map((l) => ({ value: l, label: l }))]}
        />
        <Select
          style={{ width: 130 }}
          aria-label='按状态筛选'
          value={filters.status}
          onChange={(status) => setFilters({ ...filters, status })}
          options={[
            { value: '', label: '全部状态' },
            { value: 'published', label: '已发布' },
            { value: 'withdrawn', label: '已下架' },
            { value: 'unpublished', label: '未发布' },
          ]}
        />
        <Typography.Text type='secondary' style={{ marginLeft: 'auto' }} aria-live='polite'>
          共 {sum.total} 套 · 已发布 {sum.published} · 已下架 {sum.withdrawn} · 已发布中未验证答案{' '}
          {sum.unverifiedKeys.toLocaleString('zh-CN')} 个
        </Typography.Text>
      </Flex>

      {query.isError ? (
        <Alert type='error' showIcon role='alert' title={describeReleaseError(query.error)} />
      ) : (
        <Table<AdminExam>
          rowKey='exam_id'
          loading={query.isPending}
          columns={columns}
          dataSource={shown}
          scroll={{ x: 'max-content' }}
          pagination={{ pageSize: 20, showSizeChanger: false, hideOnSinglePage: true }}
          locale={{ emptyText: '没有符合条件的试卷。' }}
          onRow={(e) => ({ 'data-testid': `row-${e.exam_id}` }) as React.HTMLAttributes<HTMLElement>}
        />
      )}

      <Modal
        open={mode === 'withdraw'}
        title={target ? `下架 ${examLabel(target)}？` : ''}
        okText='确认下架'
        cancelText='取消'
        okButtonProps={{ danger: true }}
        confirmLoading={withdraw.isPending}
        onCancel={() => setMode(null)}
        onOk={() =>
          target?.release && withdraw.mutate({ id: target.release.id, reason })
        }
        destroyOnHidden
      >
        <Space orientation='vertical' style={{ width: '100%' }}>
          <Typography.Paragraph type='secondary'>
            下架后学生端立刻看不到这套试卷，也无法继续或新建练习；学生已有的作答记录保留。可随时恢复上架。
          </Typography.Paragraph>
          <Input.TextArea
            aria-label='下架原因'
            placeholder='下架原因（选填，会记录在操作历史里）'
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
          />
        </Space>
      </Modal>

      <Modal
        open={mode === 'restore'}
        title={target ? `恢复上架 ${examLabel(target)}？` : ''}
        okText='恢复上架'
        cancelText='取消'
        confirmLoading={restore.isPending}
        onCancel={() => setMode(null)}
        onOk={() => target?.release && restore.mutate(target.release.id)}
        destroyOnHidden
      >
        <Typography.Paragraph type='secondary'>
          恢复后学生端将重新显示这套试卷（沿用下架前的版本）。
        </Typography.Paragraph>
      </Modal>
    </Flex>
  )
}

export function Exams() {
  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          试卷管理
        </Typography.Title>
        <Typography.Text type='secondary'>入库后默认直接发布；这里可以随时下架或恢复。</Typography.Text>
      </div>
      <ExamsPanel />
    </>
  )
}
