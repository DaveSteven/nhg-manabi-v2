import { useId, useRef, useState, type CSSProperties } from "react";
import { Popover } from "../../../components/select/Popover";
import { VolumeIcon } from "./icons";

/** Zone D: lightweight volume popover — mute toggle + level slider
 * (audio-player-spec.md §3.D). Not a Modal; closes on outside press/Esc. */
export function VolumeControl({ volume, muted, disabled, onVolume, onToggleMute }: {
  volume: number;
  muted: boolean;
  disabled: boolean;
  onVolume(v: number): void;
  onToggleMute(): void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const uid = useId();
  const sliderId = `${uid}-vol`;
  const effective = muted ? 0 : volume;
  return (
    <div className="audio-volume">
      <button ref={btnRef} type="button" className="audio-volume-btn"
              disabled={disabled} aria-label="音量"
              aria-expanded={open}
              aria-haspopup="true"
              onClick={() => setOpen((o) => !o)}>
        <VolumeIcon muted={muted || volume === 0} />
      </button>
      <Popover open={open} anchorRef={btnRef} minWidth={160}
               className="audio-volume-popover"
               onClose={() => setOpen(false)}>
        <div className="audio-volume-panel">
          <button type="button" className="audio-volume-mute"
                  onClick={onToggleMute}>
            {muted ? "取消静音" : "静音"}
          </button>
          <input id={sliderId} type="range" className="audio-volume-slider"
                 min={0} max={1} step={0.05} aria-label="音量大小"
                 value={muted ? 0 : volume}
                 style={{ "--progress": `${effective * 100}%` } as CSSProperties}
                 onChange={(e) => onVolume(Number(e.target.value))} />
          <span className="audio-volume-value" aria-hidden="true">
            {Math.round(effective * 100)}%
          </span>
        </div>
      </Popover>
    </div>
  );
}
