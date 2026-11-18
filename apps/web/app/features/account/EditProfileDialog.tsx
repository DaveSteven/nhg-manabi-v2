import { useEffect, useId, useRef, useState } from "react";
import { updateMe } from "../../api/endpoints/auth";
import { ApiError } from "../../api/errors";
import type { UserProfile } from "../../api/endpoints/auth";
import { authStore } from "../auth/authStore";
import { AVATARS } from "./avatars";
import { UserAvatar } from "./UserAvatar";
import { Button, ButtonLink } from "../../components/Button";

/**
 * Edit avatar + nickname in one dialog, saved with a single PATCH. Picking
 * an avatar only changes local state until 保存; the server validates the
 * id against its whitelist and the nickname length (field-level errors).
 */
export function EditProfileDialog({ user, onClose }: {
  user: UserProfile;
  onClose: () => void;
}) {
  const titleId = useId();
  const [avatar, setAvatar] = useState<string | null>(user.avatar ?? null);
  const [name, setName] = useState(user.display_name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const trimmed = name.trim();

  useEffect(() => {
    nameRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = async () => {
    if (saving || !trimmed) return;
    setSaving(true);
    setError(null);
    try {
      const me = await updateMe({ avatar, display_name: trimmed });
      authStore.setUser({
        id: me.id, email: me.email, username: me.username, display_name: me.display_name,
        current_level: me.current_level, avatar: me.avatar,
      });
      onClose();
    } catch (e) {
      // 400 = server-side field validation (message is user-readable)
      setError(e instanceof ApiError && e.status === 400
        ? e.message : "保存失败，请检查网络后重试。");
    } finally {
      setSaving(false);
    }
  };

  const preview = { id: user.id, display_name: trimmed || user.display_name,
                    avatar };

  return (
    <div className="modal-overlay"
         onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby={titleId}
           className="modal card">
        <h2 id={titleId}>编辑资料</h2>

        <div className="edit-avatar-row">
          <UserAvatar user={preview} size="lg" />
          <p className="text-aux">选择一个头像，或使用默认的纯色头像。</p>
        </div>

        <div className="avatar-grid" role="radiogroup" aria-label="头像">
          <button type="button" role="radio" aria-checked={avatar === null}
                  aria-label="默认头像"
                  className={avatar === null ? "avatar-pick is-current" : "avatar-pick"}
                  onClick={() => setAvatar(null)}>
            <UserAvatar user={{ id: user.id, display_name: trimmed || user.display_name,
                                avatar: null }} />
          </button>
          {AVATARS.map((a) => (
            <button key={a.id} type="button" role="radio"
                    aria-checked={avatar === a.id} aria-label={a.label}
                    className={avatar === a.id ? "avatar-pick is-current" : "avatar-pick"}
                    onClick={() => setAvatar(a.id)}>
              <img src={a.url} alt="" draggable={false} />
            </button>
          ))}
        </div>

        <label className="field">
          <span>昵称</span>
          <input ref={nameRef} value={name} maxLength={128}
                 onChange={(e) => setName(e.target.value)}
                 placeholder="1–128 个字符" />
        </label>

        {error ? <p role="alert" className="form-error">{error}</p> : null}

        <div className="dialog-actions">
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" onClick={save}
                  disabled={!trimmed} loading={saving}>
            {saving ? "保存中…" : "保存"}
          </Button>
        </div>
      </div>
    </div>
  );
}
