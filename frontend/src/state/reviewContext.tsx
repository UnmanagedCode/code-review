import { createContext, useContext, useEffect, type ReactNode } from 'react';
import type { CompareView, ReviewDetail } from '@/lib/endpoints';
import type { ReviewSummary, Session, Thread, ThreadCounts } from '@/lib/types';
import type { FileDiffState } from './fileDiff';
import { forgetMarks } from './readMarks';

export interface ReviewCtx extends Omit<ReviewDetail, 'review'> {
  id: string;
  review: ReviewSummary;
  /** Commit-filter view of a range review: read-only. */
  commit: string | undefined;
  /** Past-round view of a range review: read-only. */
  round: number | undefined;
  /** Comparison of two rounds of a range review (`view` once loaded): read-only. */
  compare: { from: number; to: number; view?: CompareView } | undefined;
  /** A past-round view or a comparison: no verdict UI and no review-level writes, since those act on the current round. */
  pastView: boolean;
  /**
   * The past round's or the comparison's loading state (undefined outside both): its error replaces the file tree.
   * `loaded`: its data is there (a failed reload keeps it).
   */
  viewLoad: { loading: boolean; error: unknown; loaded: boolean; reload: () => void } | undefined;
  /** Thread counts of what is shown: the viewed round's or the comparison's threads, else the review's. */
  threadCounts: ThreadCounts;
  /** True when writes are off: closed review, commit-filter view, past-round view or comparison. */
  readOnly: boolean;
  /** Counts the review's successful loads; dependants refetch when it moves. */
  version: number;
  fileDiff: FileDiffState;
  sessions: Session[];
  reload: () => void;
  applyReview: (r: ReviewSummary) => void;
}

const Ctx = createContext<ReviewCtx | null>(null);
/** One visit of a review: its read marks (`readMarks.ts`) last as long as this provider shows that review. */
export function ReviewProvider({ value, children }: { value: ReviewCtx; children: ReactNode }) {
  const { id } = value;
  useEffect(() => () => forgetMarks(id), [id]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useReviewCtx(): ReviewCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useReviewCtx outside ReviewProvider');
  return v;
}
