import { StrictMode } from 'react'
import ReactDOM from 'react-dom/client'
import { AxiosError } from 'axios'
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { AppProviders } from '@/app/providers'
import { useAuthStore } from '@/stores/auth-store'
// Generated Routes
import { routeTree } from './routeTree.gen'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Never retry auth failures; otherwise a couple of quick retries.
      retry: (failureCount, error) => {
        if (error instanceof AxiosError && [401, 403].includes(error.response?.status ?? 0)) {
          return false
        }
        return failureCount < (import.meta.env.DEV ? 0 : 2)
      },
      refetchOnWindowFocus: import.meta.env.PROD,
      staleTime: 10 * 1000,
    },
  },
  queryCache: new QueryCache({
    onError: (error) => {
      // Expired/revoked admin session: drop it and return to sign-in.
      if (error instanceof AxiosError && error.response?.status === 401) {
        useAuthStore.getState().auth.reset()
        router.navigate({ to: '/sign-in', search: { redirect: router.history.location.href } })
      }
    },
  }),
})

const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 0,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

const rootElement = document.getElementById('root')!
if (!rootElement.innerHTML) {
  ReactDOM.createRoot(rootElement).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <AppProviders>
          <RouterProvider router={router} />
        </AppProviders>
      </QueryClientProvider>
    </StrictMode>
  )
}
