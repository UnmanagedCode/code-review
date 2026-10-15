import fs from 'node:fs';
import * as store from './store.js';
import { resolveCheckout, isConductorProject } from './checkouts.js';
import { buildSnapshot, resolveTarget } from './snapshot.js';
import { followThreads } from './follow.js';
import { Refusal, refuse } from './refusals.js';

export const currentRound = (review) => review.rounds[review.rounds.length - 1];

/** Author record for an actor; roles are derived per review and frozen on what they write. */
export function authorFor(review, actor) {
  if (actor.kind === 'human') return { kind: 'human' };
  let role = 'reviewer';
  if (isConductorProject(actor.project)) role = 'conductor';
  else if (review.kind !== 'uncommitted' && actor.sessionId === review.recipient) role = 'author';
  return { kind: 'session', sessionId: actor.sessionId, role };
}

export function assertOpen(review) {
  if (review.status === 'closed') throw new Refusal('REVIEW_CLOSED', `review ${review.id} is closed`);
}

async function locateCheckout(review) {
  try {
    return await resolveCheckout({ project: review.project, worktree: review.worktree });
  } catch (e) {
    if (!(e instanceof Refusal) || !['CHECKOUT_UNKNOWN', 'PROJECT_UNKNOWN'].includes(e.code)) throw e;
    let mainPath = null;
    if (e.code === 'CHECKOUT_UNKNOWN') mainPath = (await resolveCheckout({ project: review.project, worktree: null })).path;
    return { path: null, mainPath, exists: false };
  }
}

/** Lazy, memoised view of a review's checkout and snapshots for one request. */
export function makeEnv(review) {
  let co;
  const snaps = new Map();
  const env = {
    sweep: null,
    checkout: () => (co ??= locateCheckout(review)),
    /** Directory git objects are read from; committed reviews fall back to the main checkout. */
    async repo() {
      const c = await env.checkout();
      if (c.exists) return c.path;
      if (review.kind !== 'uncommitted' && c.mainPath && fs.existsSync(c.mainPath)) return c.mainPath;
      throw new Refusal('CHECKOUT_GONE', `the checkout of review ${review.id} no longer exists`);
    },
    /** Snapshot of round `n` (default: current); uncommitted reviews are always live. */
    snapshot(n = currentRound(review).n) {
      const key = review.kind === 'uncommitted' ? 'live' : n;
      if (!snaps.has(key)) {
        snaps.set(key, (async () => {
          const repo = await env.repo();
          if (review.kind === 'uncommitted') {
            return buildSnapshot({ kind: 'uncommitted', repo, checkout: repo, ...(await resolveTarget(repo, 'uncommitted')) });
          }
          const round = review.rounds.find((r) => r.n === n);
          return buildSnapshot({ kind: review.kind, repo, checkout: repo, baseSha: round.baseSha, headSha: round.headSha });
        })());
        snaps.get(key).catch(() => snaps.delete(key));
      }
      return snaps.get(key);
    },
  };
  return env;
}

const UNREADABLE = ['CHECKOUT_GONE', 'SNAPSHOT_GONE'];

// An uncommitted review's threads follow the live working tree; an unreadable tree leaves them untouched.
async function sweep(review, env) {
  try {
    return await followThreads(review, await env.snapshot(), 'volatile');
  } catch (e) {
    if (e instanceof Refusal && UNREADABLE.includes(e.code)) return null;
    throw e;
  }
}

/** Write path: `fn(review, env)` under the review lock, after the uncommitted sweep. */
export function inReview(id, fn) {
  return store.mutate(id, async (review) => {
    const env = makeEnv(review);
    if (review.kind === 'uncommitted') env.sweep = await sweep(review, env);
    return fn(review, env);
  });
}

/** Read path: committed reviews are read lock-free; uncommitted ones sweep (and persist) first. */
export function viewReview(id, fn) {
  const review = store.read(id);
  if (!review) return refuse('REVIEW_UNKNOWN', `unknown review: ${id}`);
  if (review.kind === 'uncommitted') return inReview(id, fn);
  return fn(review, makeEnv(review));
}
