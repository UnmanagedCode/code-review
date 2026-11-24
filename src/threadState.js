// Whose move an open thread waits on, derived from who acted last. Pure: reads stored reviews, never git.

/** A human status change takes its own seq; opening and agent resolves share the seq of a message. */
export const humanChangedStatus = (t, since) => t.statusSeq > since && !t.messages.some((m) => m.seq === t.statusSeq);

const lastDeliveredRound = (review) => review.submissions.findLast((s) => s.kind === 'round' && s.status === 'delivered');

/** `seq` of the newest delivered round submission (Guide me prompts never count), 0 when none. */
export const lastDeliveredRoundSeq = (review) => lastDeliveredRound(review)?.seq ?? 0;

/**
 * True when the human did something the next Submit round would still send: the rule behind NOTHING_TO_SUBMIT.
 * Before any round is delivered the first one is always allowed, so then it is true.
 */
export const unsentActivity = (review) => !lastDeliveredRound(review) || review.humanSeq > lastDeliveredRoundSeq(review);

/** States in which the human is the one to act. */
export const NEEDS_YOU = ['awaiting-human', 'verify-resolution'];

const humanActSeq = (t) => {
  const lastMsg = t.messages.findLast((m) => m.author.kind === 'human')?.seq ?? 0;
  return humanChangedStatus(t, 0) ? Math.max(lastMsg, t.statusSeq) : lastMsg;
};
const agentActSeq = (t) => t.messages.findLast((m) => m.author.kind !== 'human')?.seq ?? 0;

/**
 * 'awaiting-human' | 'verify-resolution' | 'unsent' | 'awaiting-agent' for an open thread; null for any other status.
 * `unsent` lasts until a delivered round was composed at or after the human's last act.
 */
export function threadState(review, t, deliveredSeq = lastDeliveredRoundSeq(review)) {
  if (t.status !== 'open') return null;
  const human = humanActSeq(t);
  if (agentActSeq(t) > human) return t.resolveProposed ? 'verify-resolution' : 'awaiting-human';
  return human > deliveredSeq ? 'unsent' : 'awaiting-agent';
}

/** Open threads of every anchor by state; the four values sum to the open-thread count. */
export function stateCounts(review) {
  const delivered = lastDeliveredRoundSeq(review);
  const c = { awaitingHuman: 0, verifyResolution: 0, unsent: 0, awaitingAgent: 0 };
  const key = { 'awaiting-human': 'awaitingHuman', 'verify-resolution': 'verifyResolution', unsent: 'unsent', 'awaiting-agent': 'awaitingAgent' };
  for (const t of review.threads) {
    const s = threadState(review, t, delivered);
    if (s) c[key[s]]++;
  }
  return c;
}
