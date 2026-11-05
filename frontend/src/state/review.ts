import { useCallback } from 'react';
import * as ep from '@/lib/endpoints';
import type { GuideView, ReviewSummary } from '@/lib/types';
import { usePolling } from './live';
import { resourceKey } from './checkout';
import { useResource } from './resource';

/**
 * The open review: summary, files, rounds, submissions. Stays current by refetching on an SSE event newer than the cached
 * `rev` (never trusting the event's content), on reconnect, and (uncommitted) on focus and an interval.
 */
export function useReview(id: string | undefined) {
  const f = useResource(id ? resourceKey('review', id) : null, {
    fetch: () => ep.review(id!),
    matches: (e, data) => e.id === id && !e.deleted && (e.rev ?? 0) > (data?.review.rev ?? 0),
    // A delete leaves the entry gone, so a revisit shows the deleted state instead of the cached detail.
    gone: (e) => e.id === id && !!e.deleted,
  });
  const { reload } = f;
  usePolling(useCallback(() => reload({ join: true }), [reload]), f.data?.review.kind === 'uncommitted', f.loadedAt);

  /** Fold a mutation response's summary in at once; the SSE echo then has `rev <=` the cached rev and is ignored. */
  const applyReview = useCallback((review: ReviewSummary) => {
    f.mutate((d) => (review.rev >= d.review.rev ? { ...d, review } : d));
  }, [f.mutate]);
  /** Patches the guide inside the cached review; the server's next response replaces it. */
  const patchGuide = useCallback((fn: (g: GuideView) => GuideView) => {
    f.mutate((d) => (d.guide ? { ...d, guide: fn(d.guide) } : d));
  }, [f.mutate]);
  return { ...f, deleted: f.gone, applyReview, patchGuide };
}
export type ReviewState = ReturnType<typeof useReview>;
