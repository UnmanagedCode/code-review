import { anchorView } from './anchor.js';
import { threadView } from './rollup.js';

/** A thread's positions, oldest first: one per round it was anchored in, ending with its current anchor. */
export const anchorChain = (t) => [...t.pastAnchors, anchorView(t.anchor)];

/**
 * The review's threads as of round `n`, in the stored thread shape: {threads, unplaced}.
 * Threads opened later are absent and later messages are cut (`laterMessages` counts them). Each thread sits at its
 * anchor of round `n`; one outdated by then sits at its last located anchor. Status is the current one, except that a
 * thread outdated only later shows the status it had when it went outdated. `unplaced` holds threads whose position in
 * round `n` was never recorded (anchored before positions were kept), at their earliest known anchor.
 * Unread is 0 (`humanReadSeq` Infinity) and no resolution is proposed: a round view is read-only.
 */
export function threadsAt(review, n) {
  const threads = [];
  const unplaced = [];
  for (const t of review.threads) {
    if (t.messages[0].round > n) continue;
    const messages = t.messages.filter((m) => m.round <= n);
    const chain = anchorChain(t);
    const last = chain[chain.length - 1];
    const then = {
      ...t, messages, laterMessages: t.messages.length - messages.length,
      humanReadSeq: Infinity, resolveProposed: false, positionUnknown: false,
    };
    if (t.status === 'outdated' && n > last.round) {
      threads.push({ ...then, anchor: last });
      continue;
    }
    // Going outdated changes nothing but the status, so `resolution` still tells what it was before.
    then.status = t.status === 'outdated' ? (t.resolution ? 'resolved' : 'open') : t.status;
    const at = chain.findLast((a) => a.round <= n);
    if (at) threads.push({ ...then, anchor: at });
    else unplaced.push({ ...then, anchor: chain[0], positionUnknown: true });
  }
  return { threads, unplaced };
}

/** A thread of `threadsAt` as the API shows it. */
export const roundThreadView = (t) => ({ ...threadView(t), laterMessages: t.laterMessages, positionUnknown: t.positionUnknown });
