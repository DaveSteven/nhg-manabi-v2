import { describe, expect, it } from 'vitest'
import { activeNavKey, breadcrumbFor } from './nav'

describe('activeNavKey', () => {
  it('maps list and detail pages to their menu entry', () => {
    expect(activeNavKey('/')).toBe('/')
    expect(activeNavKey('/exams')).toBe('/exams')
    expect(activeNavKey('/users')).toBe('/users')
    expect(activeNavKey('/users/abc-123')).toBe('/users')
  })
  it('does not confuse similarly prefixed paths and falls back to home', () => {
    expect(activeNavKey('/users-archive')).toBe('/')
    expect(activeNavKey('/nope')).toBe('/')
  })
})

describe('breadcrumbFor', () => {
  it('home is a single non-link crumb', () => {
    expect(breadcrumbFor('/')).toEqual([{ label: '首页' }])
  })
  it('list page: 首页 › 试卷管理 (current is not a link)', () => {
    expect(breadcrumbFor('/exams')).toEqual([{ label: '首页', to: '/' }, { label: '试卷管理' }])
  })
  it('detail page links back to the list', () => {
    expect(breadcrumbFor('/users/u1')).toEqual([
      { label: '首页', to: '/' },
      { label: '用户管理', to: '/users' },
      { label: '详情' },
    ])
    expect(breadcrumbFor('/users/')).toEqual([{ label: '首页', to: '/' }, { label: '用户管理' }])
  })
})
