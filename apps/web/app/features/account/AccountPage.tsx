import { useState } from "react";
import { Navigate, useNavigate } from "react-router";
import { useAuth } from "../auth/authStore";
import { JLPT_LEVELS, useLevel } from "../auth/useLevel";
import { EditProfileDialog } from "./EditProfileDialog";
import { signOut } from "./AccountMenu";
import { UserAvatar } from "./UserAvatar";

/**
 * 用户中心 (/study/account): identity card with avatar/nickname/email,
 * edit entry, target-level preference, sign-out. Only real account data —
 * study statistics land with the M3 progress model, not faked here.
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
      <h1>用户中心</h1>

      <section className="card account-card" aria-label="个人资料">
        <UserAvatar user={user} size="lg" />
        <div className="account-identity">
          <p className="account-display-name">{user.display_name}</p>
          <p className="text-aux">{user.email}</p>
        </div>
        <button type="button" className="secondary-button"
                onClick={() => setEditing(true)}>
          编辑资料
        </button>
      </section>

      <section className="card account-card account-level" aria-label="备考设置">
        <label>
          <span>备考等级</span>
          <select value={level ?? ""}
                  onChange={(e) => {
                    if (e.target.value) setLevel(e.target.value as (typeof JLPT_LEVELS)[number]);
                  }}>
            <option value="">未设置</option>
            {JLPT_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </label>
        <p className="text-aux">用于试卷列表的默认等级筛选。</p>
      </section>

      <section className="account-actions">
        <button type="button" className="secondary-button" disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  await signOut();
                  navigate("/study");
                }}>
          退出登录
        </button>
      </section>

      {editing ? (
        <EditProfileDialog user={user} onClose={() => setEditing(false)} />
      ) : null}
    </div>
  );
}
