import { ACCOUNT_LABEL, ACTIVITY_LABEL, type AccountState, type Activity } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { ACTIVITY_VARIANT } from './format'

export function ActivityBadge({ activity }: { activity: Activity }) {
  return <Badge variant={ACTIVITY_VARIANT[activity]}>{ACTIVITY_LABEL[activity]}</Badge>
}

/** Only abnormal account states are flagged; normal accounts stay quiet. */
export function AccountBadge({ state }: { state: AccountState }) {
  if (state === 'normal') return null
  return (
    <Badge variant={state === 'disabled' ? 'destructive' : 'outline'}>
      {ACCOUNT_LABEL[state]}
    </Badge>
  )
}

export function UserAvatar({ name, email }: { name: string; email: string }) {
  return (
    <span
      aria-hidden='true'
      className='flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium'
    >
      {(name.trim() || email).slice(0, 1).toUpperCase()}
    </span>
  )
}
