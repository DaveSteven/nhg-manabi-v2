import { describe, expect, it } from 'vitest'
import { safeRedirect } from './safe-redirect'

describe('safeRedirect', () => {
  it('keeps same-app relative paths', () => {
    expect(safeRedirect('/')).toBe('/')
    expect(safeRedirect('/exams?x=1')).toBe('/exams?x=1')
  })
  it.each([undefined, '', 'https://evil.example', '//evil.example', 'javascript:alert(1)', '/\\evil.example'])(
    'rejects %s',
    (v) => expect(safeRedirect(v)).toBe('/')
  )
})
