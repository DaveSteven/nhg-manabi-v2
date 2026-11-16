import { logoutAccount } from "../../api/endpoints/auth";
import { authStore } from "../auth/authStore";

/** Sign out: revoke server-side best effort, always clear locally. */
export async function signOut(): Promise<void> {
  try {
    await logoutAccount();
  } catch {
    // session may already be dead server-side
  }
  authStore.clear();
}
