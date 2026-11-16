import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { AdminExam } from '@/lib/api'
import { DECISION_LABEL, examLabel, formatTime } from './filter'

const STATUS: Record<
  AdminExam['status'],
  { label: string; variant: 'default' | 'secondary' | 'outline' }
> = {
  published: { label: '已发布', variant: 'default' },
  withdrawn: { label: '已下架', variant: 'secondary' },
  unpublished: { label: '未发布', variant: 'outline' },
}

type Props = {
  exams: AdminExam[]
  busyReleaseId: string | null
  onWithdraw: (exam: AdminExam) => void
  onRestore: (exam: AdminExam) => void
}

export function ExamsTable({ exams, busyReleaseId, onWithdraw, onRestore }: Props) {
  if (exams.length === 0) {
    return (
      <p className='py-10 text-center text-sm text-muted-foreground' role='status'>
        没有符合条件的试卷。
      </p>
    )
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>级别</TableHead>
          <TableHead>试卷</TableHead>
          <TableHead>状态</TableHead>
          <TableHead className='text-end'>版本</TableHead>
          <TableHead className='text-end'>Unit（可见/总数）</TableHead>
          <TableHead className='text-end'>题数</TableHead>
          <TableHead className='text-end'>未验证答案</TableHead>
          <TableHead>最近操作</TableHead>
          <TableHead className='text-end'>操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {exams.map((e) => {
          const st = STATUS[e.status]
          const visible = e.counts.units - e.counts.hidden_units
          const rid = e.release?.id ?? null
          const busy = rid !== null && busyReleaseId === rid
          const reason =
            e.publication?.decision === 'withdrawn' &&
            typeof e.publication.note === 'string'
              ? e.publication.note
              : null
          return (
            <TableRow key={e.exam_id} data-testid={`row-${e.exam_id}`}>
              <TableCell className='font-medium'>{e.level}</TableCell>
              <TableCell>
                <div>{examLabel(e)}</div>
                <div className='text-xs text-muted-foreground'>{e.exam_id}</div>
              </TableCell>
              <TableCell>
                <Badge variant={st.variant}>{st.label}</Badge>
              </TableCell>
              <TableCell className='text-end tabular-nums'>
                {e.release ? `r${e.release.revision}` : '—'}
              </TableCell>
              <TableCell className='text-end tabular-nums'>
                {visible}/{e.counts.units}
                {e.counts.hidden_units > 0 ? (
                  <span
                    className='ms-1 text-xs text-muted-foreground'
                    title='待确认的 Unit 不会对学生显示'
                  >
                    （{e.counts.hidden_units} 个隐藏）
                  </span>
                ) : null}
              </TableCell>
              <TableCell className='text-end tabular-nums'>{e.counts.questions}</TableCell>
              <TableCell className='text-end tabular-nums'>
                {e.counts.unverified_answer_keys}
              </TableCell>
              <TableCell className='max-w-56 text-sm break-words whitespace-normal'>
                {e.publication ? (
                  <>
                    <div>{DECISION_LABEL[e.publication.decision] ?? e.publication.decision}</div>
                    <div className='text-xs text-muted-foreground'>
                      {formatTime(e.publication.decided_at)}
                    </div>
                    {reason ? (
                      <div className='text-xs text-muted-foreground'>原因：{reason}</div>
                    ) : null}
                  </>
                ) : (
                  '—'
                )}
              </TableCell>
              <TableCell className='text-end whitespace-nowrap'>
                {e.status === 'published' && rid ? (
                  <Button
                    size='sm'
                    variant='outline'
                    disabled={busy}
                    onClick={() => onWithdraw(e)}
                    aria-label={`下架 ${examLabel(e)}`}
                  >
                    下架
                  </Button>
                ) : e.status === 'withdrawn' && rid ? (
                  <Button
                    size='sm'
                    variant='outline'
                    disabled={busy}
                    onClick={() => onRestore(e)}
                    aria-label={`恢复上架 ${examLabel(e)}`}
                  >
                    恢复上架
                  </Button>
                ) : (
                  <span className='text-xs text-muted-foreground'>—</span>
                )}
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
