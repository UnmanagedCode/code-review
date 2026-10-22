/**
 * Per-thread read marks already sent during one visit of a review, keyed by review and thread, with the review version
 * they were sent at. One thread can be on screen as several cards (inline in the diff and in the force-mounted Threads
 * tab), each asking to mark it read: only the first ask per version posts. The reload a mark triggers moves the version,
 * and by then the thread reads as read, so a later unread message can be marked again.
 *
 * The version is a per-mount load counter that restarts with every visit, so a review's marks are forgotten when its
 * `ReviewProvider` unmounts or switches review (`forgetMarks`); otherwise a revisit at an equal version would be suppressed.
 */
const marks = new Map<string, number>();
const key = (reviewId: string, threadId: string) => `${reviewId}\n${threadId}`;

/** True when this ask should post: no mark for the thread was sent at `version` in this visit. Records the mark. */
export function claimMark(reviewId: string, threadId: string, version: number): boolean {
  const k = key(reviewId, threadId);
  if (marks.get(k) === version) return false;
  marks.set(k, version);
  return true;
}
/** A refused mark: forget it so it may be asked again. */
export function releaseMark(reviewId: string, threadId: string): void { marks.delete(key(reviewId, threadId)); }
/** The visit of `reviewId` ended. */
export function forgetMarks(reviewId: string): void {
  for (const k of marks.keys()) if (k.startsWith(`${reviewId}\n`)) marks.delete(k);
}
/** Test isolation: forget every mark sent. */
export function resetMarks(): void { marks.clear(); }
