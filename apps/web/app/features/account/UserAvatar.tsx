import { avatarUrl, defaultColorIndex } from "./avatars";

interface AvatarUser {
  id: string;
  display_name: string;
  avatar?: string | null;
}

/**
 * Circular avatar: the chosen fixed-set image, otherwise a solid colour
 * (stable per user id) with the first character of the nickname.
 * Decorative — callers label the surrounding control.
 */
export function UserAvatar({ user, size = "md" }: {
  user: AvatarUser;
  size?: "md" | "lg" | "xl";
}) {
  const url = avatarUrl(user.avatar);
  const cls = `user-avatar user-avatar-${size}`;
  if (url) {
    return (
      <span className={`${cls} user-avatar-img`} aria-hidden="true">
        <img src={url} alt="" draggable={false} />
      </span>
    );
  }
  return (
    <span className={`${cls} user-avatar-c${defaultColorIndex(user.id)}`}
          aria-hidden="true">
      {Array.from(user.display_name.trim())[0] ?? "?"}
    </span>
  );
}
