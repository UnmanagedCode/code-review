import * as store from './store.js';
import { lookupScope } from './lookups.js';
import { mapLimit, ROW_CONCURRENCY } from './limit.js';
import { attempt } from './refusals.js';
import { inboxItem } from './rollup.js';

/**
 * `checkoutGone` per review, from cc's metadata only: one location lookup per project and one worktrees lookup per project
 * with a worktree review, `ROW_CONCURRENCY` at a time on one lookup scope. A lookup that fails (already logged by `ccFetch`)
 * leaves its rows unknown (null), unless another lookup already says gone.
 */
async function goneMarks(reviews) {
  const scope = lookupScope();
  const settle = (p) => p.then((value) => ({ value }), () => null);
  const keyOf = (r) => JSON.stringify([r.project, r.worktree]);
  const asks = new Map();
  for (const r of reviews) {
    asks.set(JSON.stringify([r.project, null]), () => scope.project(r.project));
    if (r.worktree !== null) asks.set(keyOf(r), () => scope.worktree(r.project, r.worktree));
  }
  const answers = await mapLimit([...asks.values()], ROW_CONCURRENCY, (ask) => settle(ask()));
  const listed = new Map([...asks.keys()].map((k, i) => [k, answers[i] ? answers[i].value !== null : null]));
  return reviews.map((r) => {
    const known = [listed.get(JSON.stringify([r.project, null]))];
    if (r.worktree !== null) known.push(listed.get(keyOf(r)));
    if (known.includes(false)) return true;
    return known.includes(null) ? null : false;
  });
}

// Store-integrity guard: a file `migrateStore` could not upgrade (or one copied in since) lacks the inbox's fields; it is logged and left out.
function migrated(review) {
  const missing = ['lastActivityAt', 'agentSeq'].filter((k) => review[k] === undefined);
  if (!missing.length) return true;
  store.logSkipped(review.id, 'left out of the inbox', new Error(`not migrated: no ${missing.join(', ')}`));
  return false;
}

/** Every open review of every checkout, latest activity first. Store-only plus cc's metadata: no git, no System is asked. */
export const listInbox = () => attempt(async () => {
  const open = store.list().filter((r) => r.status === 'open' && migrated(r));
  const gone = open.length ? await goneMarks(open) : [];
  const reviews = open.map((r, i) => inboxItem(r, gone[i]))
    .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt) || b.id.localeCompare(a.id));
  return { ok: true, reviews };
});
