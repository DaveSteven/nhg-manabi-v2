import { type QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router'
import { GeneralError, NotFoundError } from '@/features/errors'

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient
}>()({
  component: () => <Outlet />,
  notFoundComponent: NotFoundError,
  errorComponent: GeneralError,
})
