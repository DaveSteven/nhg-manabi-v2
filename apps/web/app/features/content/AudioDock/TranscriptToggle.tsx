/** 「原文」dock entry (audio-player.md §2.2/§8): text + icon, never a bare
 * arrow. Locked (before the reveal gate opens) stays visible with a lock
 * hint instead of vanishing; expanded exposes aria-expanded/aria-controls. */
export function TranscriptToggle({ expanded, locked, panelId, disabled, onToggle }: {
  expanded: boolean;
  locked: boolean;
  panelId: string;
  disabled: boolean;
  onToggle(): void;
}) {
  const label = locked ? "原文（提交后可查看）" : "原文";
  return (
    <button type="button" className="audio-transcript-toggle"
            aria-expanded={expanded} aria-controls={expanded ? panelId : undefined}
            aria-label={label} title={label}
            disabled={disabled}
            onClick={onToggle}>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none"
           stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
           strokeLinejoin="round" aria-hidden="true">
        <path d="M4 6h16" />
        <path d="M4 11h16" />
        <path d="M4 16h9" />
        {expanded
          ? <path d="m7 19 3-3 3 3" />
          : locked
            ? <>
                <rect x="15" y="14" width="6" height="6" rx="1.2" />
                <path d="M16.5 14v-1.5a1.5 1.5 0 0 1 3 0V14" />
              </>
            : <path d="m7 13 3 3 3-3" />}
      </svg>
      <span>原文</span>
    </button>
  );
}
