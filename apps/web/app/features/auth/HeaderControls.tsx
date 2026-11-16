import { Link } from "react-router";
import { useAuth } from "./authStore";
import { UserAvatar } from "../account/UserAvatar";

/**
 * Right slot of the study header (design v1.1 §3.1): signed-in students see
 * only their avatar, which links straight to the user center (no menu —
 * sign-out lives there); guests see 登录/注册. The target-level selector is
 * in the user center too (user decisions 2026-11-16).
 */
export function HeaderControls() {
  const auth = useAuth();
  return (
    <div className="header-controls-inner">
      {auth.user ? (
        <Link to="/study/account" className="account-avatar-button"
              aria-label="用户中心">
          <UserAvatar user={{ ...auth.user, avatar: auth.user.avatar ?? null }} />
        </Link>
      ) : (
        <div className="account-links">
          <Link className="account-signin" to="/login">登录</Link>
          <Link className="account-signup" to="/register">注册</Link>
        </div>
      )}
    </div>
  );
}
