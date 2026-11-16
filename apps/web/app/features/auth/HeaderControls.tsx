import { Link } from "react-router";
import { useAuth } from "./authStore";
import { AccountMenu } from "../account/AccountMenu";

/**
 * Right slot of the study header (design v1.1 §3.1): signed-in students see
 * only their avatar (menu: 用户中心 / 退出登录); guests see 登录/注册. The
 * target-level selector now lives in the user center (user decision
 * 2026-11-16: top right shows only the avatar).
 */
export function HeaderControls() {
  const auth = useAuth();
  return (
    <div className="header-controls-inner">
      {auth.user ? (
        <AccountMenu user={{ ...auth.user, avatar: auth.user.avatar ?? null }} />
      ) : (
        <div className="account-links">
          <Link className="account-signin" to="/login">登录</Link>
          <Link className="account-signup" to="/register">注册</Link>
        </div>
      )}
    </div>
  );
}
