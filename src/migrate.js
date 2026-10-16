import * as store from './store.js';
import { Refusal } from './refusals.js';

/** The review-file format this code reads and writes. */
export const SCHEMA = 2;

/** Upgrades one stored review in place to `SCHEMA`; a review already there is left untouched. */
export function migrateReview(review) {
  if (review.schema >= SCHEMA) return;
  // 1 -> 2: threads keep their positions in earlier rounds. None were recorded before, so the history starts empty.
  for (const t of review.threads) t.pastAnchors ??= [];
  review.schema = SCHEMA;
}

/** Startup: upgrades every stored review. Idempotent; an unconfigured store has nothing to migrate. */
export async function migrateStore() {
  let reviews;
  try { reviews = store.list(); } catch (e) {
    if (e instanceof Refusal && e.code === 'STORE_UNCONFIGURED') return;
    throw e;
  }
  for (const r of reviews) await store.mutate(r.id, migrateReview); // writes only a review that changed
}
