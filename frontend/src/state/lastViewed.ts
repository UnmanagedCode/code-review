import { useEffect, useRef } from 'react';
import * as ep from '@/lib/endpoints';
import type { ReviewSummary } from '@/lib/types';

/**
 * "Since you last looked": the server keeps one `lastViewedSeq` per review, advanced by the UI while the review is open.
 * The feed must not empty while the human reads it, so a visit pins the marker as first loaded (`baseline`) and the feed
 * lists what is newer than that. A visit ends when the review's `ReviewProvider` unmounts (`forgetVisit`) or the page reloads.
 */
const baselines = new Map<string, number>();
// The newest seq a viewed write was sent for, per review: one write per loaded seq.
const sent = new Map<string, number>();

/** The marker this visit started from; pinned on first ask. */
export function visitBaseline(review: Pick<ReviewSummary, 'id' | 'lastViewedSeq'>): number {
  if (!baselines.has(review.id)) baselines.set(review.id, review.lastViewedSeq);
  return baselines.get(review.id)!;
}
/** The visit of `reviewId` ended. */
export function forgetVisit(reviewId: string): void { baselines.delete(reviewId); sent.delete(reviewId); }
/** Test isolation. */
export function resetVisits(): void { baselines.clear(); sent.clear(); }

/**
 * Pins the visit's baseline and, while the tab is visible and the loaded review is ahead of its marker, posts `viewed` with the
 * seq the UI loaded (never a newer one it has not shown). Returns the baseline.
 */
export function useLastViewed(review: ReviewSummary, onSaved: (r: ReviewSummary) => void): number {
  const baseline = visitBaseline(review);
  const save = useRef(onSaved);
  save.current = onSaved;
  const { id, seq, lastViewedSeq } = review;
  useEffect(() => {
    const post = () => {
      if (document.visibilityState === 'hidden' || seq <= lastViewedSeq || (sent.get(id) ?? -1) >= seq) return;
      sent.set(id, seq);
      ep.markViewed(id, seq).then((res) => save.current(res.review), () => { if (sent.get(id) === seq) sent.delete(id); });
    };
    post();
    document.addEventListener('visibilitychange', post);
    return () => document.removeEventListener('visibilitychange', post);
  }, [id, seq, lastViewedSeq]);
  return baseline;
}
