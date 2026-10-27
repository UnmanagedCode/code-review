import * as store from './store.js';
import * as git from './git.js';
import { UNREACHABLE } from './exec.js';
import { lookupCheckout, isConductorProject } from './checkouts.js';
import { lookupScope } from './lookups.js';
import { buildSnapshot, cachedSnapshot, snapshotGone } from './snapshot.js';
import { followThreads } from './follow.js';
import { Refusal, refuse } from './refusals.js';

export const currentRound = (review) => review.rounds[review.rounds.length - 1];

/** Role of a session on a review: the conductor, the author (stored `author`, else the recipient; never on an uncommitted review), else a reviewer. */
export function roleOf(review, sessionId, isConductor) {
  if (isConductor) return 'conductor';
  if (review.kind !== 'uncommitted' && sessionId === (review.author || review.recipient)) return 'author';
  return 'reviewer';
}

/** Role of the review's recipient; it is the conductor exactly when it is the conductor session that opened the review. */
export function recipientRole(review) {
  if (!review.recipient) return null;
  const openedByIt = review.createdBy.role === 'conductor' && review.createdBy.sessionId === review.recipient;
  return roleOf(review, review.recipient, openedByIt);
}

/** Author record for an actor; roles are derived per review and frozen on what they write. */
export function authorFor(review, actor) {
  if (actor.kind === 'human') return { kind: 'human' };
  return { kind: 'session', sessionId: actor.sessionId, role: roleOf(review, actor.sessionId, isConductorProject(actor.project)) };
}

export function assertOpen(review) {
  if (review.status === 'closed') throw new Refusal('REVIEW_CLOSED', `review ${review.id} is closed`);
}

// cc's view of the review's checkout (runs nothing). A checkout cc no longer knows has no place; its main one stays.
async function locateCheckout(review, scope) {
  try {
    return await lookupCheckout({ project: review.project, worktree: review.worktree }, scope);
  } catch (e) {
    if (!(e instanceof Refusal) || !['CHECKOUT_UNKNOWN', 'PROJECT_UNKNOWN'].includes(e.code)) throw e;
    const main = e.code === 'CHECKOUT_UNKNOWN' ? await lookupCheckout({ project: review.project, worktree: null }, scope) : null;
    return { path: null, place: null, mainPath: main?.path ?? null, mainPlace: main?.place ?? null };
  }
}

/** Lazy, memoised view of a review's checkout and snapshots for one request; `scope` shares cc lookups across the request. */
export function makeEnv(review, scope = lookupScope()) {
  let co;
  let probed;
  const snaps = new Map();
  const gone = () => new Refusal('CHECKOUT_GONE', `the checkout of review ${review.id} no longer exists`);
  const env = {
    sweep: null,
    /** {path, place, mainPath, mainPlace, …} from cc; `path`/`place` null when cc no longer knows the checkout. */
    checkout: () => (co ??= locateCheckout(review, scope)),
    /**
     * One exec: {where: 'checkout'|'main'|null, missing, status} for the checkout (else, on committed reviews, its main
     * one), the current round's shas, and (`status`, asked by the first caller only) the checkout's git status.
     * A checkout git does not find evicts the project's cached lookups.
     */
    probe({ status = false } = {}) {
      if (probed) return probed;
      probed = (async () => {
        const c = await env.checkout();
        const at = c.place ?? c.mainPlace;
        if (!at) return { where: null, missing: null, status: null };
        const cur = currentRound(review);
        const mainPath = review.kind === 'uncommitted' ? '' : c.mainPath;
        const r = await git.probe(at, { path: c.path, mainPath, status, shas: [cur.baseSha, cur.headSha] });
        if (r.where !== 'checkout') scope.evict(review.project);
        return r;
      })();
      probed.catch(() => { probed = null; });
      return probed;
    },
    /** Place git objects are read from; committed reviews fall back to the main checkout. */
    async repo() {
      const c = await env.checkout();
      if (review.kind === 'uncommitted') {
        await env.snapshot();
        return c.place;
      }
      const { where } = await env.probe();
      if (where === 'checkout') return c.place;
      if (where === 'main') return c.mainPlace;
      throw gone();
    },
    /** The current round's committed snapshot if this process has built it (at the checkout, else its main one), else null; runs nothing. */
    async cachedSnapshot() {
      const c = await env.checkout();
      const { baseSha, headSha } = currentRound(review);
      for (const repo of [c.place, c.mainPlace].filter(Boolean)) {
        const snap = cachedSnapshot({ kind: review.kind, repo, baseSha, headSha });
        if (snap) return snap;
      }
      return null;
    },
    /** Snapshot of round `n` (default: current); uncommitted reviews are always live. */
    snapshot(n = currentRound(review).n) {
      const key = review.kind === 'uncommitted' ? 'live' : n;
      if (!snaps.has(key)) {
        snaps.set(key, (async () => {
          const c = await env.checkout();
          if (review.kind === 'uncommitted') {
            if (!c.place) throw gone();
            // The threads' lines are read in the same call, so the sweep reads nothing more.
            const prefetch = review.threads.filter((t) => t.status !== 'outdated').map((t) => ({ side: t.anchor.side, file: t.anchor.file }));
            return buildSnapshot({ kind: 'uncommitted', checkout: c.place, prefetch }).catch((e) => {
              if (e.code === 'CHECKOUT_GONE') scope.evict(review.project);
              throw e;
            });
          }
          const round = review.rounds.find((r) => r.n === n);
          if (n !== currentRound(review).n) {
            const repo = await env.repo();
            return buildSnapshot({ kind: review.kind, repo, checkout: repo, baseSha: round.baseSha, headSha: round.headSha });
          }
          const p = await env.probe();
          if (!p.where) throw gone();
          if (p.missing) throw snapshotGone(p.missing);
          const repo = p.where === 'checkout' ? c.place : c.mainPlace;
          return buildSnapshot({ kind: review.kind, repo, checkout: repo, baseSha: round.baseSha, headSha: round.headSha, verified: true });
        })());
        snaps.get(key).catch(() => snaps.delete(key));
      }
      return snaps.get(key);
    },
  };
  return env;
}

const UNREADABLE = ['CHECKOUT_GONE', 'SNAPSHOT_GONE', 'TEMP_UNUSABLE', ...UNREACHABLE];

// An uncommitted review's threads follow the live working tree; an unreadable tree leaves them untouched.
async function sweep(review, env) {
  try {
    return await followThreads(review, await env.snapshot(), 'volatile', { round: currentRound(review).n });
  } catch (e) {
    if (e instanceof Refusal && UNREADABLE.includes(e.code)) return null;
    throw e;
  }
}

/** Write path: `fn(review, env)` under the review lock, after the uncommitted sweep. */
export function inReview(id, fn, scope = lookupScope()) {
  return store.mutate(id, async (review) => {
    const env = makeEnv(review, scope);
    if (review.kind === 'uncommitted') env.sweep = await sweep(review, env);
    return fn(review, env);
  });
}

/** Read path: committed reviews are read lock-free; uncommitted ones sweep (and persist) first. */
export function viewReview(id, fn, scope = lookupScope()) {
  const review = store.read(id);
  if (!review) return refuse('REVIEW_UNKNOWN', `unknown review: ${id}`);
  if (review.kind === 'uncommitted') return inReview(id, fn, scope);
  return fn(review, makeEnv(review, scope));
}
