import { describe, expect, it } from 'vitest'
import type { AdminExam } from '@/lib/api'
import { filterExams, formatTime, summarize } from './filter'

const mk = (over: Partial<AdminExam> & { exam_id: string }): AdminExam => ({
  level: 'N2', year: 2018, month: 12, title: '2018年12月 N2', status: 'published',
  release: { id: 'r', revision: 1, state: 'published', is_current: true, published_at: null },
  counts: { units: 10, hidden_units: 1, questions: 12, unverified_answer_keys: 12 },
  publication: null, ...over,
})
const data = [
  mk({ exam_id: 'JLPTGO-N2-2018-12' }),
  mk({ exam_id: 'JLPTGO-N1-2019-07', level: 'N1', year: 2019, month: 7, title: '2019年7月 N1' }),
  mk({ exam_id: 'JLPTGO-N2-2020-12', year: 2020, title: '2020年12月 N2', status: 'withdrawn' }),
]

describe('filterExams', () => {
  it('filters by level, status and free text', () => {
    expect(filterExams(data, { q: '', level: 'N1', status: '' })).toHaveLength(1)
    expect(filterExams(data, { q: '', level: '', status: 'withdrawn' })[0].exam_id).toBe('JLPTGO-N2-2020-12')
    expect(filterExams(data, { q: '2019', level: '', status: '' })[0].level).toBe('N1')
    expect(filterExams(data, { q: ' jlptgo-n2 ', level: '', status: '' })).toHaveLength(2)
  })
  it('combines filters with AND and returns nothing for no match', () => {
    expect(filterExams(data, { q: '2020', level: 'N1', status: '' })).toHaveLength(0)
  })
})

describe('summarize', () => {
  it('counts statuses and only counts unverified keys of PUBLISHED exams', () => {
    const s = summarize(data)
    expect(s).toEqual({ total: 3, published: 2, withdrawn: 1, unverifiedKeys: 24 })
  })
})

describe('formatTime', () => {
  it('handles null and garbage', () => {
    expect(formatTime(null)).toBe('—')
    expect(formatTime('not a date')).toBe('—')
    expect(formatTime('2026-11-16T10:00:00Z')).toContain('2026')
  })
})
