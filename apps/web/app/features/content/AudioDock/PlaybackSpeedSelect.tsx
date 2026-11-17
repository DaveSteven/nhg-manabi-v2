import { Select } from "../../../components/select";

const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5];

/** Zone D: playback speed via the shared compact Select + Popover
 * (audio-player-spec.md §3.D). */
export function PlaybackSpeedSelect({ value, disabled, onChange }: {
  value: number;
  disabled: boolean;
  onChange(rate: number): void;
}) {
  return (
    <Select
      className="audio-speed"
      size="compact"
      aria-label="播放速度"
      value={String(value)}
      disabled={disabled}
      popoverMinWidth={110}
      items={SPEED_OPTIONS.map((r) => ({ value: String(r), label: `${r}×` }))}
      onChange={(v) => onChange(Number(v))}
    />
  );
}
