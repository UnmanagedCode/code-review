import { attempt, Refusal } from './refusals.js';
import { viewReview } from './context.js';
import { buildSnapshot } from './snapshot.js';
import { fileStates, tally, diffFiles } from './rollup.js';
import { hunkFor } from './anchor.js';
import { threadsAt, roundThreadView, anchorChain, reviewThreadsAt } from './history.js';
import { pickRound } from './rounds.js';

const byNumber = (a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1));

// Outdated threads are never followed again, so they went outdated in the round after their last located one.
const outdatedRound = (t) => (t.status === 'outdated' ? anchorChain(t).at(-1).round + 1 : null);

/**
 * Where one copy sits in the comparison (old side = round A's head, new side = round B's head), or why it cannot.
 * A head-side anchor of round n is line-for-line in round n's head, so its numbers carry over unchanged.
 * A file anchor sits on its comparison file, whatever that file's content.
 */
function placeCopy(c, files) {
  const from = c.placement === 'from';
  const wholeFile = c.anchor.kind === 'file';
  if (!wholeFile && c.anchor.side === 'old') return { reason: 'base-side' };
  const f = files.find((x) => (from ? (x.oldPath ?? x.path) === c.anchor.file && x.status !== 'added' : x.path === c.anchor.file && x.status !== 'deleted'));
  if (!f) return { reason: 'unchanged-file' };
  if (wholeFile) return { path: f.path, copy: { ...c, anchor: { ...c.anchor, file: f.path } } };
  if (f.binary || f.tooLarge) return { reason: 'no-lines' };
  const anchor = { ...c.anchor, file: f.path, side: from ? 'old' : 'new' };
  anchor.hunkId = hunkFor(anchor, f.hunks);
  return { path: f.path, copy: { ...c, anchor } };
}

/**
 * The threads of rounds `from` (A) and `to` (B) placed in the comparison's `files`: a from-copy of each thread live in
 * A (as of A, on the old side) and a to-copy of each thread live in B (as of B, on the new side).
 * `unplaced` has one entry per thread with no placed copy: its to-copy if it has one, else its from-copy.
 * Review threads sit on no file and are not compared.
 */
export function placeThreads({ review, from, to, files }) {
  const stored = new Map(review.threads.map((t) => [t.id, t]));
  const copies = (n, placement) => threadsAt(review, n).filter((t) => t.status !== 'outdated' && t.anchor.kind !== 'review').map((t) => {
    const out = placement === 'from' ? outdatedRound(stored.get(t.id)) : null;
    return { ...roundThreadView(t), placement, outdatedIn: out !== null && out <= to ? out : null };
  });
  const byFile = new Map();
  const missed = new Map();
  const placedIds = new Set();
  for (const c of [...copies(from, 'from'), ...copies(to, 'to')]) {
    const p = placeCopy(c, files);
    if (p.reason) {
      missed.set(c.id, { ...c, reason: p.reason }); // a to-copy comes later and replaces the from-copy
      continue;
    }
    placedIds.add(c.id);
    if (!byFile.has(p.path)) byFile.set(p.path, []);
    byFile.get(p.path).push(p.copy);
  }
  for (const list of byFile.values()) list.sort(byNumber);
  const unplaced = [...missed.values()].filter((c) => !placedIds.has(c.id)).sort(byNumber);
  const compared = new Set([...placedIds, ...missed.keys()]);
  return { byFile, unplaced, counts: tally(threadsAt(review, to).filter((t) => compared.has(t.id))) };
}

/**
 * Read-only comparison of two rounds of a range review: round A's head against round B's head, limited to the files
 * either round reviews, with each round's threads where they sat in it.
 */
export const compareRounds = (id, { from, to }) => attempt(() => viewReview(id, async (review, env) => {
  const a = pickRound(review, from);
  const b = pickRound(review, to);
  if (a.n >= b.n) throw new Refusal('INVALID_ARGUMENT', 'from must be an earlier round than to');
  const [snapA, snapB] = await Promise.all([env.snapshot(a.n), env.snapshot(b.n)]);
  const repo = await env.repo();
  const delta = await buildSnapshot({ kind: 'range', repo, checkout: repo, baseSha: a.headSha, headSha: b.headSha });
  const inA = new Set(snapA.files.map((f) => f.path));
  const inB = new Set(snapB.files.map((f) => f.path));
  // Keeps upstream churn out when the base moved between the rounds, but keeps a file reverted to base in B.
  const files = delta.files.filter((f) => inB.has(f.path) || inA.has(f.oldPath ?? f.path));
  const { byFile, unplaced, counts } = placeThreads({ review, from: a.n, to: b.n, files });
  const states = await diffFiles(delta, fileStates({ ...review, threads: [], verdicts: {} }, files).map((s) => ({ ...s, verdicts: null })), files, {
    hunk: (h) => ({ ...h, verdict: null }), threads: (path) => byFile.get(path) ?? [],
  });
  return { ok: true, readOnly: true, from: a, to: b, files: states, counts, unplaced, reviewThreads: reviewThreadsAt(review, b.n) };
}));
