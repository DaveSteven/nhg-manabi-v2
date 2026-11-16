import { createFileRoute, redirect } from '@tanstack/react-router'
import { AxiosError } from 'axios'
import { adminMe } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import { AuthenticatedLayout } from '@/components/layout/authenticated-layout'

/**
 * Route guard. NOT a security boundary (the FastAPI admin endpoints enforce
 * auth on every request, ADR-0008/0009); it validates the session against
 * the server so a stale/forged token never shows the admin shell.
 */
export const Route = createFileRoute('/_authenticated')({
  beforeLoad: async ({ location }) => {
    const { auth } = useAuthStore.getState()
    const toSignIn = () =>
      redirect({ to: '/sign-in', search: { redirect: location.href } })

    if (!auth.accessToken) throw toSignIn()
    try {
      const me = await adminMe()
      auth.setUser({
        id: me.id,
        username: me.username,
        displayName: me.display_name,
        role: me.role,
      })
    } catch (e) {
      if (e instanceof AxiosError && e.response?.status === 401) {
        auth.reset()
        throw toSignIn()
      }
      throw e // backend unreachable: surface the error page, do not fake a session
    }
  },
  component: AuthenticatedLayout,
})
