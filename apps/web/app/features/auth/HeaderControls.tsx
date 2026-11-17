import { Link } from "react-router";
import { useAuth } from "./authStore";
import { JLPT_LEVELS, useLevel } from "./useLevel";
import { UserAvatar } from "../account/UserAvatar";
import { Select } from "../../components/select";
import { ButtonLink } from "../../components/Button";

/**
 * Right slot of the study header (design v1.1 §3.1): everyone gets the
 * target-level selector (guests keep it in localStorage and may choose 全部等级).
 * Signed-in students also see their avatar, which links straight to the user
 * center (no menu — sign-out lives there); guests see 登录/注册.
 */
export function HeaderControls() {
  const auth = useAuth();
  return (
    <div className="header-controls-inner">
      <LevelSelect signedIn={Boolean(auth.user)} />
      {auth.user ? (
        <Link to="/study/account" className="account-avatar-button"
              aria-label="用户中心">
          <UserAvatar user={{ ...auth.user, avatar: auth.user.avatar ?? null }} />
        </Link>
      ) : (
        <div className="account-links">
          <ButtonLink variant="secondary" size="sm" to="/login">登录</ButtonLink>
          <ButtonLink variant="primary" size="sm" to="/register">注册</ButtonLink>
        </div>
      )}
    </div>
  );
}

const LEVEL_ITEMS = JLPT_LEVELS.map((l) => ({ value: l, label: l }));
// guests may go back to "all levels"; a signed-in profile always has one
const GUEST_LEVEL_ITEMS = [{ value: "", label: "全部等级" }, ...LEVEL_ITEMS];

function LevelSelect({ signedIn }: { signedIn: boolean }) {
  const { level, setLevel, clearLevel } = useLevel();
  return (
    <Select variant="text" aria-label="备考等级" placeholder="等级"
            value={level ?? ""}
            items={signedIn ? LEVEL_ITEMS : GUEST_LEVEL_ITEMS}
            onChange={(v) => (v === "" ? clearLevel()
              : setLevel(v as (typeof JLPT_LEVELS)[number]))} />
  );
}
