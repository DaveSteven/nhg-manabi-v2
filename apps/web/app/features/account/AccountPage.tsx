import { useState } from "react";
import { Navigate, useNavigate } from "react-router";
import { useAuth } from "../auth/authStore";
import { JLPT_LEVELS, useLevel } from "../auth/useLevel";
import { EditProfileDialog } from "./EditProfileDialog";
import { signOut } from "./signOut";
import { UserAvatar } from "./UserAvatar";
import { Select } from "../../components/select";
import { Button, ButtonLink } from "../../components/Button";

const LEVEL_ITEMS = JLPT_LEVELS.map((l) => ({ value: l, label: l }));

/**
 * 用户中心 (/study/account), v1-style two columns: identity card on the
 * left (avatar/nickname/email/edit), grouped setting cards on the right
 * (target level, account). Only real account data — study statistics
 * land with the M3 progress model, not faked here. Stacks on narrow screens.
 */
export function AccountPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const { level, setLevel } = useLevel();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!auth.user) {
    return <Navigate to="/login" replace />;
  }
  const user = { ...auth.user, avatar: auth.user.avatar ?? null };

  return (
    <div className="account-page">
      <h1 className="account-title">用户中心</h1>

      <aside className="card account-profile" aria-label="个人资料">
        <UserAvatar user={user} size="xl" />
        <div className="account-identity">
          <p className="account-display-name">{user.display_name}</p>
          <p className="text-aux">{user.email ?? user.username}</p>
        </div>
        <Button variant="secondary"
                onClick={() => setEditing(true)}>
          编辑资料
        </Button>
      </aside>

      <div className="account-groups">
        <section className="card account-group" aria-label="备考目标">
          <h2 className="account-group-title">备考目标</h2>
          <div className="account-row">
            <div className="account-row-text">
              <strong>目标级别</strong>
              <small>试卷列表默认按此级别筛选</small>
            </div>
            <Select aria-label="备考等级" placeholder="未设置"
                    value={level ?? ""} items={LEVEL_ITEMS}
                    onChange={(v) => setLevel(v as (typeof JLPT_LEVELS)[number])} />
          </div>
        </section>

        <section className="card account-group" aria-label="账号">
          <h2 className="account-group-title">账号</h2>
          <div className="account-row">
            <div className="account-row-text">
              <strong>{user.email ? "登录邮箱" : "登录用户名"}</strong>
              <small>{user.email ?? user.username}</small>
            </div>
          </div>
          <div className="account-row">
            <div className="account-row-text">
              <strong>结束本次会话</strong>
              <small>退出后需要重新登录</small>
            </div>
            <Button variant="secondary" loading={busy}
                    onClick={async () => {
                      setBusy(true);
                      await signOut();
                      navigate("/study");
                    }}>
              退出登录
            </Button>
          </div>
        </section>
      </div>

      {editing ? (
        <EditProfileDialog user={user} onClose={() => setEditing(false)} />
      ) : null}
    </div>
  );
}
