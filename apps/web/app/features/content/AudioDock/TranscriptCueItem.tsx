import { RichText } from "../richtext/RichText";
import { FORMAT } from "../richtext/schema";
import type { TranscriptCue } from "../../../api/dto/practice";

/** Cue children are the INLINE children of one paragraph; wrapping them
 * in a single-paragraph doc reuses the exact RichText whitelist pipeline
 * (no new rendering surface, cues never bypass it). */
function cueDoc(children: unknown): unknown {
  return { format: FORMAT, blocks: [{ type: "paragraph", children }] };
}

/** A cue is seekable only with reliable timestamps (audio-player.md §7):
 * finite ints with 0 <= start < end. Anything else renders as plain text —
 * we never guess a missing interval. */
export function cueIsSeekable(cue: TranscriptCue): boolean {
  const { start_ms: s, end_ms: e } = cue;
  return typeof s === "number" && typeof e === "number"
    && Number.isFinite(s) && Number.isFinite(e) && s >= 0 && s < e;
}

export function cueIsActive(cue: TranscriptCue, currentTimeMs: number): boolean {
  if (!cueIsSeekable(cue)) return false;
  const s = cue.start_ms as number;
  const e = cue.end_ms as number;
  return s <= currentTimeMs && currentTimeMs < e;
}

/** One transcript paragraph (audio-player.md §4.2). Time-range labels are
 * intentionally NOT shown (user decision 2026-11-17, reaffirmed) —
 * timestamps drive highlight/seek only. Active cue: sakura background. */
export function TranscriptCueItem({ cue, active, currentTimeMs, onSeek }: {
  cue: TranscriptCue;
  active: boolean;
  currentTimeMs: number;
  onSeek(seconds: number): void;
}) {
  const seekable = cueIsSeekable(cue);
  const body = <RichText value={cueDoc(cue.children)} />;
  if (!seekable) {
    return (
      <div className={`transcript-cue${active ? " is-active" : ""}`}
           data-cue-index={cue.index}>
        {body}
      </div>
    );
  }
  return (
    <button type="button"
            className={`transcript-cue is-seekable${active ? " is-active" : ""}`}
            data-cue-index={cue.index}
            aria-current={active || undefined}
            aria-label="播放此段落"
            onClick={() => onSeek((cue.start_ms as number) / 1000)}>
      {body}
    </button>
  );
}
