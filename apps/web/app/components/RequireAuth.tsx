import { Navigate, Outlet, useLocation } from "react-router";
import { useAuth } from "../features/auth/authStore";

/**
 * Pathless layout route that guards everything nested under it (ADR-0036).
 * routes.ts decides what is public by what it nests here — there is no path
 * list to keep in sync. Guests, and sessions dropped after a 401, go to
 * /login with `state.from` so sign-in returns to the page they wanted.
 * VITE_DEV_USER_TOKEN is the dev-tooling identity (no cached profile).
 */
export function RequireAuth() {
  const auth = useAuth();
  const location = useLocation();
  if (!auth.user && !import.meta.env.VITE_DEV_USER_TOKEN) {
    return <Navigate to="/login" replace
                     state={{ from: `${location.pathname}${location.search}` }} />;
  }
  return <Outlet />;
}
