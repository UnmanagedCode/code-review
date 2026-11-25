import type { InboxItem } from './types';

export type InboxBucket = 'needs-you' | 'waiting' | 'nothing';

export const BUCKET_LABEL: Record<InboxBucket, string> = { 'needs-you': 'Needs you', waiting: 'Waiting on agent', nothing: 'Nothing pending' };
const ORDER: readonly InboxBucket[] = ['needs-you', 'waiting', 'nothing'];

/** Threads that wait on the human: the agent replied, or says it fixed it. */
export const needsYouOf = (r: InboxItem): number => r.threadStates.awaitingHuman + r.threadStates.verifyResolution;

/**
 * Where a review sits in the triage: waiting when the newest submission is with the agent; else needs-you when anything is
 * the human's to do (a thread, an undecided hunk or group, unsent work, a review never opened, a submission to re-send).
 */
export function bucketOf(r: InboxItem): InboxBucket {
  if (r.turn === 'agent') return 'waiting';
  const submission = r.lastSubmission?.status;
  const open = needsYouOf(r) > 0 || (r.hunks?.pending ?? 0) > 0 || r.groupsPending > 0 || r.unsent || !r.seenByHuman
    || submission === 'pending' || submission === 'failed';
  return open ? 'needs-you' : 'nothing';
}

/** The rows in sections (needs you, waiting, nothing pending), the server's order kept inside each; empty sections are left out. */
export function groupInbox(items: InboxItem[]): { bucket: InboxBucket; items: InboxItem[] }[] {
  return ORDER.map((bucket) => ({ bucket, items: items.filter((r) => bucketOf(r) === bucket) })).filter((s) => s.items.length > 0);
}
