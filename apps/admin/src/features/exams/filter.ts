import type { AdminExam } from '@/lib/api'

export type ExamFilters = {
  q: string
  level: string // '' = all
  status: string // '' = all
}

/** Display title: "2018年12月 N2" style, falling back to the exam id. */
export function examLabel(e: AdminExam): string {
  return e.title || `${e.year}年${e.month}月 ${e.level}`
}

export function filterExams(exams: AdminExam[], f: ExamFilters): AdminExam[] {
  const q = f.q.trim().toLowerCase()
  return exams.filter((e) => {
    if (f.level && e.level !== f.level) return false
    if (f.status && e.status !== f.status) return false
    if (q) {
      const hay = `${e.exam_id} ${examLabel(e)} ${e.year} ${e.month}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

export function summarize(exams: AdminExam[]) {
  return {
    total: exams.length,
    published: exams.filter((e) => e.status === 'published').length,
    withdrawn: exams.filter((e) => e.status === 'withdrawn').length,
    unverifiedKeys: exams.reduce(
      (n, e) => n + (e.status === 'published' ? e.counts.unverified_answer_keys : 0),
      0
    ),
  }
}

export const DECISION_LABEL: Record<string, string> = {
  auto_published: '自动发布',
  approved: '人工发布',
  withdrawn: '已下架',
  restored: '已恢复上架',
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('zh-CN', { hour12: false })
}
