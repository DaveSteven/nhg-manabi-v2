import { type Activity } from '@/lib/api'

const JST = 'Asia/Tokyo'

/** Date-time in Japan time; missing → dash (never a stand-in value). */
export function formatJst(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('zh-CN', { hour12: false, timeZone: JST })
}

/** `YYYY-MM-DD` calendar dates from the server are already Tokyo days. */
export const formatDay = (day: string | null | undefined) => day || '—'

/** antd Tag colour per activity class. */
export const ACTIVITY_COLOR: Record<Activity, string> = {
  active: 'green',
  inactive: 'blue',
  dormant: 'default',
  not_started: 'orange',
}

/** `YYYY-MM-DD` of an instant in Japan time. */
export function formatJstDay(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('sv-SE', { timeZone: JST })
}
