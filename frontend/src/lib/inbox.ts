import type { InboxBucket, InboxItem } from './types';

export const BUCKET_LABEL: Record<InboxBucket, string> = { 'needs-you': 'Needs you', waiting: 'Waiting on agent', nothing: 'Nothing pending', stale: 'Stale' };

/** Threads that wait on the human: the agent replied, or says it fixed it. */
export const needsYouOf = (r: InboxItem): number => r.threadStates.awaitingHuman + r.threadStates.verifyResolution;

/** The rows in sections by their served `bucket`, sections and rows in the server's order; there are no empty sections. */
export function groupInbox(items: InboxItem[]): { bucket: InboxBucket; items: InboxItem[] }[] {
  const sections = new Map<InboxBucket, InboxItem[]>();
  for (const r of items) sections.set(r.bucket, [...(sections.get(r.bucket) ?? []), r]);
  return [...sections].map(([bucket, rows]) => ({ bucket, items: rows }));
}
