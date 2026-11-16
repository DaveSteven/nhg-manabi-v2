/** Only same-app relative paths are honoured after sign-in (no open redirect). */
export function safeRedirect(target: string | undefined): string {
  if (target && target.startsWith('/') && !target.startsWith('//')) {
    // Backslash tricks like /\evil.com are treated as non-local by browsers.
    if (target.includes('\\')) return '/'
    return target
  }
  return '/'
}
