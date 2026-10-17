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

/**
 * Startup: upgrades every stored review. Idempotent; an unconfigured store has nothing to migrate.
 * A review that cannot be read or migrated is logged and left as it is, so it still fails loudly when read, while the
 * rest migrate and the server starts.
 */
export async function migrateStore() {
  let ids;
  try { ids = store.ids(); } catch (e) {
    if (e instanceof Refusal && e.code === 'STORE_UNCONFIGURED') return;
    throw e;
  }
  for (const id of ids) {
    try {
      await store.mutate(id, migrateReview); // writes only a review that changed
    } catch (e) {
      console.error(`code-review: review ${id} left unmigrated: ${e.message}`);
    }
  }
}
