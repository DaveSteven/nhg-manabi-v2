/** Admin navigation: single source for the sidebar menu and the breadcrumb. */
export interface NavEntry {
  key: string
  label: string
  path: '/' | '/exams' | '/users'
}

export const NAV: NavEntry[] = [
  { key: '/', label: '首页', path: '/' },
  { key: '/exams', label: '试卷管理', path: '/exams' },
  { key: '/users', label: '用户管理', path: '/users' },
]

/** Which menu entry owns this pathname (`/users/abc` → `/users`). */
export function activeNavKey(pathname: string): string {
  const hit = NAV.find((n) => n.path !== '/' && (pathname === n.path || pathname.startsWith(`${n.path}/`)))
  return hit?.key ?? '/'
}

export interface Crumb {
  label: string
  to?: NavEntry['path']
}

/** Breadcrumb trail: 首页 › 用户管理 › 用户详情. */
export function breadcrumbFor(pathname: string): Crumb[] {
  const key = activeNavKey(pathname)
  const entry = NAV.find((n) => n.key === key)!
  if (key === '/') return [{ label: '首页' }]
  const trail: Crumb[] = [{ label: '首页', to: '/' }]
  const isDetail = pathname.replace(/\/+$/, '') !== entry.path
  trail.push(isDetail ? { label: entry.label, to: entry.path } : { label: entry.label })
  if (isDetail) trail.push({ label: '详情' })
  return trail
}
