import { treeOrder } from './fileTree';
import type { FileState, ReviewSummary } from './types';

/** The current round's hunks: `decided` = accepted + rejected of `total`. Null when verdicts do not apply or the snapshot is unreadable. */
export function reviewProgress(review: ReviewSummary): { decided: number; undecided: number; total: number } | null {
  const h = review.counts.hunks;
  if (!h || 'total' in h || review.snapshotError) return null;
  const decided = h.accepted + h.rejected;
  return { decided, undecided: h.pending, total: decided + h.pending };
}

/** A file's decided hunks out of its hunks; null on a review without verdicts. */
export const fileProgress = (f: FileState): { decided: number; total: number } | null => (f.verdicts ? { decided: f.verdicts.accepted + f.verdicts.rejected, total: f.hunks } : null);

/** The first file, in tree order, that still has an undecided hunk. */
export const firstUndecided = (files: FileState[]): FileState | undefined => treeOrder(files).find((f) => (f.verdicts?.pending ?? 0) > 0);
