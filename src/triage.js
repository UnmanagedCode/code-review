import { lastDeliveredRound } from './threadState.js';

/** A review idle for longer than this (strictly) is stale. */
export const STALE_AFTER_MS = 14 * 24 * 60 * 60 * 1000;

/** The inbox sections, in display order. */
export const BUCKETS = ['needs-you', 'waiting', 'nothing', 'stale'];

/** Why a review needs the human, most urgent first: `reasons` lists the applicable codes in this order. */
export const REASONS = ['threads', 'send-failed', 'send-pending', 'hunks', 'groups', 'not-opened', 'unsent', 'never-sent'];

function reasonsOf(review, item) {
  const sub = item.lastSubmission?.status;
  const primary = {
    threads: item.threadStates.awaitingHuman + item.threadStates.verifyResolution > 0,
    'send-failed': sub === 'failed',
    'send-pending': sub === 'pending',
    hunks: (item.hunks?.pending ?? 0) > 0,
    groups: item.groupsPending > 0,
    'not-opened': !item.seenByHuman,
  };
  const found = REASONS.filter((code) => primary[code]);
  // Fallbacks keep a review with unsent work but no other trigger from sitting in Needs you unexplained.
  if (!found.length && item.unsent) found.push(lastDeliveredRound(review) ? 'unsent' : 'never-sent');
  return found;
}

/**
 * Triage of one inbox row at `now` (ms): `{ bucket, reasons, staleReasons }`. `checkout-gone` only for `checkoutGone === true`
 * (null = cc could not say); `idle` when older than `STALE_AFTER_MS`. Stale beats every other section.
 */
export function triage(review, item, now) {
  const reasons = reasonsOf(review, item);
  const staleReasons = [];
  if (item.checkoutGone === true) staleReasons.push('checkout-gone');
  if (now - Date.parse(item.lastActivityAt) > STALE_AFTER_MS) staleReasons.push('idle');
  let bucket = 'nothing';
  if (staleReasons.length) bucket = 'stale';
  else if (item.turn === 'agent') bucket = 'waiting';
  else if (reasons.length) bucket = 'needs-you';
  return { bucket, reasons, staleReasons };
}

const urgency = (row) => (row.bucket === 'needs-you' ? REASONS.indexOf(row.reasons[0]) : 0);

/** Inbox order: bucket, then (Needs you) most urgent reason, then latest activity, then id, each descending after the first two. */
export const compareRows = (a, b) => BUCKETS.indexOf(a.bucket) - BUCKETS.indexOf(b.bucket)
  || urgency(a) - urgency(b)
  || b.lastActivityAt.localeCompare(a.lastActivityAt)
  || b.id.localeCompare(a.id);
