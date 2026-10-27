import { attempt, Refusal } from './refusals.js';
import { viewReview } from './context.js';
import { fileStates, tally, signStates, diffFiles } from './rollup.js';
import { threadsAt, roundThreadView } from './history.js';

const invalid = (reason) => new Refusal('INVALID_ARGUMENT', reason);

/** The stored round `raw` names; past-round views exist for range reviews only. The current round is a valid pick. */
export function pickRound(review, raw) {
  if (review.kind !== 'range') throw invalid('past-round views apply to range reviews only');
  if (!/^[1-9]\d*$/.test(String(raw))) throw invalid('round must be a positive integer');
  const round = review.rounds.find((r) => r.n === Number(raw));
  if (!round) throw new Refusal('ROUND_UNKNOWN', `review ${review.id} has no round ${raw}`);
  return round;
}

// The review as of one round: that round's snapshot and its threads where they were then.
async function asOf(review, env, raw) {
  const round = pickRound(review, raw);
  const snap = await env.snapshot(round.n);
  return { round, snap, then: { ...review, threads: threadsAt(review, round.n) } };
}

const noVerdicts = (states) => states.map((s) => ({ ...s, verdicts: null }));

/** The threads placed in one file as of a round (`then` = the review as of it), not outdated by then. */
export const roundThreadsOn = (then, path) => then.threads.filter((t) => t.status !== 'outdated' && t.anchor.file === path).map(roundThreadView);

// How past-round views render a file: no verdicts, the round's threads.
const pastView = (then) => ({ hunk: (h) => ({ ...h, verdict: null }), threads: (path) => roundThreadsOn(then, path) });

/** Read-only view of one round of a range review: its files, the counts of its threads, and its outdated threads. */
export const roundView = (id, raw) => attempt(() => viewReview(id, async (review, env) => {
  const { round, snap, then } = await asOf(review, env, raw);
  return {
    ok: true, readOnly: true, round,
    files: signStates(snap, noVerdicts(fileStates(then, snap.files)), snap.files, pastView(then)),
    counts: tally(then.threads),
    outdatedThreads: then.threads.filter((t) => t.status === 'outdated').map(roundThreadView),
  };
}));

/** `diff` of a past round: its hunks (no verdicts) and the threads sitting in each file then. */
export async function roundDiff(review, env, { file, round: raw }) {
  const { round, snap, then } = await asOf(review, env, raw);
  const picked = file ? snap.files.filter((f) => f.path === file) : snap.files;
  if (file && !picked.length) throw new Refusal('FILE_NOT_IN_DIFF', `${file} is not in round ${round.n}'s diff`);
  return {
    ok: true, readOnly: true, round,
    files: await diffFiles(snap, noVerdicts(fileStates(then, picked)), picked, pastView(then)),
  };
}
