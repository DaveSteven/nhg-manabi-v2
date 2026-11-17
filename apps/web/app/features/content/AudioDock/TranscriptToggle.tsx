/** 「原文」dock entry (audio-player.md §2.2/§8): text + a single chevron on
 * the RIGHT (user decision 2026-11-17 — the earlier lines+chevron combo
 * overlapped). Locked (before the reveal gate opens) stays visible with a
 * lock hint instead of vanishing; expanded exposes aria-expanded/controls. */
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
      <span>原文</span>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none"
           stroke="currentColor" strokeWidth="2" strokeLinecap="round"
           strokeLinejoin="round" aria-hidden="true"
           style={{ transform: expanded ? "rotate(180deg)" : undefined,
                    transition: "transform 160ms" }}>
        <path d="m6 9 6 6 6-6" />
      </svg>
    </button>
  );
}
