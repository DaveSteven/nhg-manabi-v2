import { Link } from "react-router";
import { useAuth } from "./authStore";
import { JLPT_LEVELS, useLevel } from "./useLevel";
import { UserAvatar } from "../account/UserAvatar";
import { Select } from "../../components/select";

/**
 * Right slot of the study header (design v1.1 §3.1): signed-in students see
 * the target-level selector and their avatar, which links straight to the
 * user center (no menu — sign-out lives there); guests see 登录/注册.
 */
export function HeaderControls() {
  const auth = useAuth();
  return (
    <div className="header-controls-inner">
      {auth.user ? (
        <>
          <LevelSelect />
          <Link to="/study/account" className="account-avatar-button"
                aria-label="用户中心">
            <UserAvatar user={{ ...auth.user, avatar: auth.user.avatar ?? null }} />
          </Link>
        </>
      ) : (
        <div className="account-links">
          <Link className="account-signin" to="/login">登录</Link>
          <Link className="account-signup" to="/register">注册</Link>
        </div>
      )}
    </div>
  );
}

const LEVEL_ITEMS = JLPT_LEVELS.map((l) => ({ value: l, label: l }));

function LevelSelect() {
  const { level, setLevel } = useLevel();
  return (
    <Select variant="text" aria-label="备考等级" placeholder="等级"
            value={level ?? ""} items={LEVEL_ITEMS}
            onChange={(v) => setLevel(v as (typeof JLPT_LEVELS)[number])} />
  );
}
