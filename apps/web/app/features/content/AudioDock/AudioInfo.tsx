import { HeadphonesIcon } from "./icons";

/** Zone A: headphone icon + audio name + owning practice group
 * (audio-player-spec.md §3.A). */
export function AudioInfo({ title, subtitle }: {
  title: string;
  subtitle?: string | null;
}) {
  return (
    <div className="audio-info">
      <span className="audio-info-icon" aria-hidden="true"><HeadphonesIcon /></span>
      <div className="audio-info-text">
        <span className="audio-title">{title}</span>
        {subtitle ? <span className="audio-subtitle">{subtitle}</span> : null}
      </div>
    </div>
  );
}
