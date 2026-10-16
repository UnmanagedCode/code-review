import { useCallback, useEffect, useRef, useState } from 'react';
import * as ep from '@/lib/endpoints';
import type { ReviewSummary } from '@/lib/types';
import { usePolling, useSseReload } from './live';
import { useFetch } from './useFetch';

/**
 * The open review: summary, files, rounds, submissions. Stays current by refetching on an SSE event newer than `knownRev`
 * (never trusting the event's content), on reconnect, and (uncommitted) on focus and an interval.
 */
export function useReview(id: string | undefined) {
  const f = useFetch(id ? () => ep.review(id) : null, [id]);
  const [deleted, setDeleted] = useState(false);
  const knownRev = useRef(0);
  const rev = f.data?.review.rev;
  useEffect(() => { if (rev != null) knownRev.current = Math.max(knownRev.current, rev); }, [rev]);
  useEffect(() => { setDeleted(false); knownRev.current = 0; }, [id]);

  useSseReload(f.reload, (e) => {
    if (e.id !== id) return false;
    if (e.deleted) { setDeleted(true); return false; }
    return (e.rev ?? 0) > knownRev.current;
  }, !!id);
  usePolling(f.reload, f.data?.review.kind === 'uncommitted');

  /** Fold a mutation response's summary in at once; the SSE echo then has `rev <= knownRev` and is ignored. */
  const applyReview = useCallback((review: ReviewSummary) => {
    knownRev.current = Math.max(knownRev.current, review.rev);
    f.mutate((d) => ({ ...d, review }));
  }, [f.mutate]);
  return { ...f, deleted, applyReview };
}
export type ReviewState = ReturnType<typeof useReview>;
