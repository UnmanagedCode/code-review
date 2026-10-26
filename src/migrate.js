import * as store from './store.js';
import { Refusal } from './refusals.js';

// Every wall-clock stamp a stored review carries; ISO strings, so the latest is the string max.
const stamps = (review) => [
  review.createdAt,
  ...review.threads.flatMap((t) => t.messages.map((m) => m.at)),
  ...Object.values(review.verdicts).map((v) => v.at),
  ...review.rounds.map((r) => r.createdAt),
  ...review.submissions.flatMap((s) => [s.composedAt, s.deliveredAt]),
].filter((at) => typeof at === 'string');

const latest = (review) => stamps(review).reduce((a, b) => (b > a ? b : a));

// Agent refreshes left no trace before `agentSeq` existed, so only agent messages count.
const lastAgentSeq = (review) => Math.max(0, ...review.threads.flatMap((t) => t.messages.filter((m) => m.author.kind !== 'human').map((m) => m.seq)));

/** Adds `lastActivityAt` and `agentSeq` where missing; a review that has both is left as it is. */
function backfill(review) {
  if (review.lastActivityAt === undefined) review.lastActivityAt = latest(review);
  if (review.agentSeq === undefined) review.agentSeq = lastAgentSeq(review);
}

/**
 * Upgrades every stored review to the current shape, once, at startup. Each step self-checks, so a second run writes nothing.
 * A file that cannot be read is logged and left untouched; an unconfigured store is a no-op (the API answers 503 anyway).
 */
export async function migrateStore() {
  let ids;
  try {
    ids = store.ids();
  } catch (e) {
    if (e instanceof Refusal && e.code === 'STORE_UNCONFIGURED') return;
    throw e;
  }
  for (const id of ids) {
    try {
      await store.mutate(id, backfill);
    } catch (e) {
      store.logSkipped(id, 'not migrated', e);
    }
  }
}
