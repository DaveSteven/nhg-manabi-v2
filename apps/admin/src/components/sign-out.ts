import { adminLogout } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

/** Revoke the server session (best effort), then clear local state. */
export async function signOut(): Promise<void> {
  try {
    await adminLogout()
  } catch {
    /* an expired session is already revoked server-side */
  }
  useAuthStore.getState().auth.reset()
}
