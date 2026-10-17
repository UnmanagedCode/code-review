import { createContext, useContext, type ReactNode } from 'react';
import type { ReviewDetail } from '@/lib/endpoints';
import type { ReviewSummary, Session, Thread, ThreadCounts } from '@/lib/types';
import type { FileDiffState } from './fileDiff';

export interface ReviewCtx extends Omit<ReviewDetail, 'review'> {
  id: string;
  review: ReviewSummary;
  /** Commit-filter view of a range review: read-only. */
  commit: string | undefined;
  /** Past-round view of a range review: read-only. */
  round: number | undefined;
  /** The past round's loading state (undefined outside a round view): its error replaces the file tree. */
  roundLoad: { loading: boolean; error: unknown; reload: () => void } | undefined;
  /** Threads whose position in the viewed round was never recorded (round views only; else empty). */
  unplacedThreads: Thread[];
  /** Thread counts of what is shown: the viewed round's placed threads, else the review's. */
  threadCounts: ThreadCounts;
  /** True when writes are off: closed review, commit-filter view or past-round view. */
  readOnly: boolean;
  /** Counts the review's successful loads; dependants refetch when it moves. */
  version: number;
  fileDiff: FileDiffState;
  sessions: Session[];
  reload: () => void;
  applyReview: (r: ReviewSummary) => void;
}

const Ctx = createContext<ReviewCtx | null>(null);
export const ReviewProvider = ({ value, children }: { value: ReviewCtx; children: ReactNode }) => <Ctx.Provider value={value}>{children}</Ctx.Provider>;
export function useReviewCtx(): ReviewCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useReviewCtx outside ReviewProvider');
  return v;
}
