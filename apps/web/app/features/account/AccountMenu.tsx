import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { logoutAccount } from "../../api/endpoints/auth";
import { authStore } from "../auth/authStore";
import type { UserProfile } from "../../api/endpoints/auth";
import { UserAvatar } from "./UserAvatar";

/** Sign out: revoke server-side best effort, always clear locally. */
export async function signOut(): Promise<void> {
  try {
    await logoutAccount();
  } catch {
    // session may already be dead server-side
  }
  authStore.clear();
}

/** Header right slot for signed-in students: just the avatar + a small menu. */
export function AccountMenu({ user }: { user: UserProfile }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="account-menu" ref={root}>
      <button type="button" className="account-avatar-button"
              aria-label="账户菜单" aria-haspopup="menu" aria-expanded={open}
              onClick={() => setOpen((v) => !v)}>
        <UserAvatar user={user} />
      </button>
      {open ? (
        <div className="account-popover" role="menu">
          <div className="account-popover-id">
            <strong>{user.display_name}</strong>
            <span>{user.email}</span>
          </div>
          <Link to="/study/account" role="menuitem"
                onClick={() => setOpen(false)}>用户中心</Link>
          <button type="button" role="menuitem" disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    await signOut();
                    setBusy(false);
                    setOpen(false);
                    navigate("/study");
                  }}>
            退出登录
          </button>
        </div>
      ) : null}
    </div>
  );
}
