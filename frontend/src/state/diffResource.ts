import * as ep from '@/lib/endpoints';
import type { DiffFile } from '@/lib/types';
import { resourceKey } from './checkout';
import type { Spec } from './resource';

/** The cache key of one file's diff in the live view (`round` undefined) or a past round. */
export const diffKey = (reviewId: string, round: number | undefined, path: string): string =>
  resourceKey('diff', reviewId, round === undefined ? '' : String(round), path);

/**
 * Never aged out: a file's diff is refetched when its `sig` moves, not by time or events. `tag` is the review's load
 * counter when a fetch starts; the entry keeps it with the diff, as the baseline for a file without a sig.
 */
export const diffSpec = (reviewId: string, round: number | undefined, path: string, tag?: () => string): Spec<DiffFile> => ({
  tag,
  fetch: async () => (await (round ? ep.roundDiff(reviewId, round, path) : ep.diff(reviewId, path))).files[0],
  maxAgeMs: Infinity,
});
