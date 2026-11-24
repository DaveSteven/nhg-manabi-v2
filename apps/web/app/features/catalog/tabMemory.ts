/**
 * Remember the selected 学科 tab of the exam detail page (sessionStorage,
 * this browser tab only) so coming back from a practice lands on the same
 * subject. Per paper first; a paper never opened before falls back to the
 * subject used last on any paper. Storage failures are silently ignored.
 */
const LAST = "exam-tab:last";
const key = (examId: string) => `exam-tab:${examId}`;

export function readTabSubject(examId: string): string | null {
  try {
    return sessionStorage.getItem(key(examId)) ?? sessionStorage.getItem(LAST);
  } catch {
    return null;
  }
}

export function saveTabSubject(examId: string, subject: string): void {
  try {
    sessionStorage.setItem(key(examId), subject);
    sessionStorage.setItem(LAST, subject);
  } catch {
    /* private mode / quota: remembering is best-effort */
  }
}
