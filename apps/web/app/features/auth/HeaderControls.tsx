import { Link, useNavigate } from "react-router";
import { useState } from "react";
import { logoutAccount } from "../../api/endpoints/auth";
import { useAuth, authStore } from "./authStore";
import { useLevel, JLPT_LEVELS } from "./useLevel";

/**
 * Right slot of the study header (design v1.1 §3.1): account entry, plus
 * the JLPT target-level selector for signed-in students (user decision
 * 2026-11-16: guests don't see the selector). Real state only — no fake
 * avatar.
 */
export function HeaderControls() {
  const auth = useAuth();
  return (
    <div className="header-controls-inner">
      {auth.user ? <LevelSelect /> : null}
      <AccountArea />
    </div>
  );
}

function LevelSelect() {
  const { level, setLevel } = useLevel();
  return (
    <label className="level-select">
      <span className="sr-only">备考等级</span>
      <select value={level ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                setLevel(v as (typeof JLPT_LEVELS)[number]);
              }}>
        <option value="">等级</option>
        {JLPT_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
      </select>
    </label>
  );
}

function AccountArea() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  if (!auth.user) {
    return (
      <div className="account-links">
        <Link className="account-signin" to="/login">登录</Link>
        <Link className="account-signup" to="/register">注册</Link>
      </div>
    );
  }

  const signOut = async () => {
    setBusy(true);
    try {
      await logoutAccount();
    } catch {
      // session may already be dead server-side; clear locally regardless
    }
    authStore.clear();
    setBusy(false);
    navigate("/study");
  };

  return (
    <div className="account-area">
      <span className="account-name">{auth.user.display_name}</span>
      <button type="button" className="account-signout" onClick={signOut}
              disabled={busy}>
        退出
      </button>
    </div>
  );
}
