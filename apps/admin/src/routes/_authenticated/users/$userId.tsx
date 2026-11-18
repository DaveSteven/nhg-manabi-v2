import { createFileRoute } from '@tanstack/react-router'
import { UserDetailPage } from '@/features/users/detail'

export const Route = createFileRoute('/_authenticated/users/$userId')({
  component: function UserDetailRoute() {
    const { userId } = Route.useParams()
    return <UserDetailPage userId={userId} />
  },
})
