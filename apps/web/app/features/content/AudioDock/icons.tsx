/** Line icons for the audio dock (audio-player-spec.md §3/§4): inline SVG,
 * stroke = currentColor, no emoji. */

interface IconProps {
  size?: number;
}

export function HeadphonesIcon({ size = 18 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none"
         stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
         strokeLinejoin="round" aria-hidden="true">
      <path d="M4 14v-3a8 8 0 0 1 16 0v3" />
      <rect x="3" y="14" width="4" height="6" rx="1.5" />
      <rect x="17" y="14" width="4" height="6" rx="1.5" />
    </svg>
  );
}

export function PlayIcon({ size = 20 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor"
         aria-hidden="true">
      <path d="M8 5.5v13a.6.6 0 0 0 .92.5l10.2-6.5a.6.6 0 0 0 0-1L8.92 5A.6.6 0 0 0 8 5.5Z" />
    </svg>
  );
}

export function PauseIcon({ size = 20 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor"
         aria-hidden="true">
      <rect x="6.5" y="5" width="4" height="14" rx="1" />
      <rect x="13.5" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}

export function Back5Icon({ size = 18 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none"
         stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
         strokeLinejoin="round" aria-hidden="true">
      <path d="M4 5v5h5" />
      <path d="M4.6 10a8 8 0 1 1-.6 3" />
      <text x="12" y="16.5" textAnchor="middle" fontSize="8.5"
            fill="currentColor" stroke="none"
            fontFamily="inherit" fontWeight="600">5</text>
    </svg>
  );
}

export function Forward5Icon({ size = 18 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none"
         stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
         strokeLinejoin="round" aria-hidden="true">
      <path d="M20 5v5h-5" />
      <path d="M19.4 10a8 8 0 1 0 .6 3" />
      <text x="12" y="16.5" textAnchor="middle" fontSize="8.5"
            fill="currentColor" stroke="none"
            fontFamily="inherit" fontWeight="600">5</text>
    </svg>
  );
}

export function VolumeIcon({ size = 18, muted = false }: IconProps & { muted?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none"
         stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
         strokeLinejoin="round" aria-hidden="true">
      <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4Z" fill="currentColor"
            stroke="currentColor" />
      {muted ? (
        <>
          <path d="m16 9.5 5 5" />
          <path d="m21 9.5-5 5" />
        </>
      ) : (
        <>
          <path d="M15.5 9.5a4 4 0 0 1 0 5" />
          <path d="M18 7.5a7 7 0 0 1 0 9" />
        </>
      )}
    </svg>
  );
}
