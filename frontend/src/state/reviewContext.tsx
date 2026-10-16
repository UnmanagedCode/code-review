import { createContext, useContext, type ReactNode } from 'react';
import type { ReviewDetail } from '@/lib/endpoints';
import type { ReviewSummary, Session } from '@/lib/types';
import type { FileDiffState } from './fileDiff';

export interface ReviewCtx extends Omit<ReviewDetail, 'review'> {
  id: string;
  review: ReviewSummary;
  /** Commit-filter view of a range review: read-only. */
  commit: string | undefined;
  /** True when writes are off: closed review or commit-filter view. */
  readOnly: boolean;
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
