import { Avatar, Tag } from 'antd'
import { ACCOUNT_LABEL, ACTIVITY_LABEL, type AccountState, type Activity } from '@/lib/api'
import { ACTIVITY_COLOR } from './format'

export function ActivityBadge({ activity }: { activity: Activity }) {
  return <Tag color={ACTIVITY_COLOR[activity]}>{ACTIVITY_LABEL[activity]}</Tag>
}

/** Only abnormal account states are flagged; normal accounts stay quiet. */
export function AccountBadge({ state }: { state: AccountState }) {
  if (state === 'normal') return null
  return <Tag color={state === 'disabled' ? 'red' : 'gold'}>{ACCOUNT_LABEL[state]}</Tag>
}

export function UserAvatar({ name, email, size = 32 }: { name: string; email: string | null; size?: number }) {
  return (
    <Avatar size={size} aria-hidden='true'>
      {(name.trim() || email || '?').slice(0, 1).toUpperCase()}
    </Avatar>
  )
}
