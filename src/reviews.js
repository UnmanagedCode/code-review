import * as store from './store.js';
import * as git from './git.js';
import { withLock } from './mutex.js';
import { attempt, refuse, Refusal } from './refusals.js';
import { UNREACHABLE } from './exec.js';
import { resolveCheckout, forkPoints, sessions, sessionCheckout, isConductorProject } from './checkouts.js';
import { resolveTarget, buildSnapshot, isBinaryFile } from './snapshot.js';
import { followThreads } from './follow.js';
import { currentRound, authorFor, assertOpen, inReview, viewReview } from './context.js';
import { summarize, fileStates, hunkView, threadView, targetLabel } from './rollup.js';
import { pickRound, roundDiff } from './rounds.js';

const KINDS = ['range', 'commit', 'uncommitted'];
const VERDICTS = ['pending', 'accepted', 'rejected'];
const UNREADABLE = ['CHECKOUT_GONE', 'SNAPSHOT_GONE', 'DIFF_TOO_LARGE', ...UNREACHABLE];
const now = () => new Date().toISOString();

/** Bumps the review-wide change counter; every human or agent mutation takes a fresh seq. */
export const bump = (review) => ++review.seq;

const invalid = (reason) => new Refusal('INVALID_ARGUMENT', reason);

/** One human verdict: its own seq, recorded as the latest human activity. */
function record(review, hunkId, verdict) {
  const seq = bump(review);
  review.humanSeq = seq;
  if (verdict === 'pending') delete review.verdicts[hunkId];
  else review.verdicts[hunkId] = { verdict, seq, at: now() };
}

/**
 * ReviewSummary for a review inside its request context. A system that cannot answer is a `snapshotError`, never
 * `checkoutGone`: the list still shows the review.
 */
export async function summaryOf(review, env) {
  let snapshotError = null;
  const unreadable = (codes) => (e) => {
    if (!(e instanceof Refusal) || !codes.includes(e.code)) throw e;
    snapshotError ??= e.code;
    return null;
  };
  const co = await env.checkout().catch(unreadable(UNREACHABLE));
  const files = co && (await env.snapshot().then((s) => s.files, unreadable(UNREADABLE)));
  let headMoved = false;
  let dirty = false;
  if (co?.exists && review.kind !== 'uncommitted') {
    const st = await git.statusOf(co.place).catch(unreadable(UNREACHABLE));
    dirty = st?.dirty ?? false;
    if (st && review.kind === 'range') headMoved = st.head !== currentRound(review).headSha;
  }
  return summarize(review, files ?? null, { headMoved, dirty, checkoutGone: co ? !co.exists : false, snapshotError });
}

/** Fresh summary of a stored review (re-read, so `rev` is current). */
export const summaryById = (id) => viewReview(id, async (review, env) => ({ ok: true, review: await summaryOf(review, env) }));

/** Recipient of a human-created review: the explicit session, else the single live attached one, else none. */
async function resolveRecipient(explicit, checkout) {
  if (explicit) {
    if (!(await sessionCheckout(explicit))) throw new Refusal('RECIPIENT_UNKNOWN', `unknown session: ${explicit}`);
    return explicit;
  }
  const attached = (await sessions(checkout)).filter((s) => s.attached);
  return attached.length === 1 ? attached[0].sessionId : null;
}

/** Opens a review, or returns the open one with the same target. An agent opener is the recipient; only a conductor names an `author`. */
export const openReview = (args, actor) => attempt(() => withLock('create', async () => {
  const kind = args.kind ?? 'range';
  if (!KINDS.includes(kind)) throw invalid(`kind must be one of ${KINDS.join(', ')}`);
  if (args.author !== undefined) {
    if (actor.kind !== 'agent' || !isConductorProject(actor.project)) throw invalid('only a conductor names an author');
    if (kind === 'uncommitted') throw invalid('an uncommitted review has no author: the human is the author');
    if (!(await sessionCheckout(args.author))) throw new Refusal('AUTHOR_UNKNOWN', `unknown session: ${args.author}`);
  }
  const worktree = args.worktree || null;
  const co = await resolveCheckout({ project: args.project, worktree });
  if (!co.exists) throw new Refusal('CHECKOUT_GONE', `${co.path} does not exist`);
  const target = {};
  if (kind === 'range') {
    target.base = args.base ?? (await forkPoints(co))[0]?.ref;
    if (!target.base) throw new Refusal('BASE_REQUIRED', 'a range review of a main checkout needs a base');
  }
  const shas = await resolveTarget(co.place, kind, kind === 'commit' ? { sha: args.sha } : target);
  if (kind === 'commit') target.sha = shas.headSha;

  const same = (r) => r.status === 'open' && r.project === args.project && r.worktree === worktree && r.kind === kind
    && r.target.base === target.base && r.target.sha === target.sha;
  const existing = store.list().find(same);
  if (existing) return { ok: true, review: (await summaryById(existing.id)).review, reused: true };

  const snap = await buildSnapshot({ kind, repo: co.place, checkout: co.place, ...shas });
  const recipient = actor.kind === 'agent' ? actor.sessionId : await resolveRecipient(args.recipient, { project: args.project, worktree });
  const branch = co.branch ?? (await git.currentBranch(co.place));
  const review = {
    id: store.newId(), project: args.project, worktree, branch, kind, target,
    baseLabel: kind === 'range' ? target.base : null, title: '', status: 'open', createdAt: now(), createdBy: null,
    recipient, author: args.author ?? null, seenByHuman: actor.kind === 'human', rev: 0, seq: 0, humanSeq: 0, nextThread: 1, nextSubmission: 1,
    rounds: [{ n: 1, ...shas, fingerprint: snap.fingerprint, createdAt: now(), submittedAt: null }],
    verdicts: {}, threads: [], droppedThreads: [], submissions: [],
  };
  review.createdBy = authorFor(review, actor);
  review.title = args.title || targetLabel(review);
  store.write(review);
  return { ok: true, review: (await summaryById(review.id)).review, reused: false };
}));

/** Summaries, newest first. `worktree` undefined = every checkout of the project; null = the main one. */
export const listReviews = ({ project, worktree, status } = {}) => attempt(async () => {
  const stored = store.list()
    .filter((r) => (!project || r.project === project) && (worktree === undefined || r.worktree === worktree) && (!status || status === 'all' || r.status === status))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  const out = [];
  for (const r of stored) out.push((await summaryById(r.id)).review);
  return { ok: true, reviews: out };
});

export const getReview = (id) => attempt(() => viewReview(id, async (review, env) => {
  const summary = await summaryOf(review, env);
  const files = summary.snapshotError ? [] : fileStates(review, (await env.snapshot()).files);
  return {
    ok: true, review: summary, files, rounds: review.rounds, submissions: review.submissions,
    outdatedThreads: review.threads.filter((t) => t.status === 'outdated').map(threadView),
  };
}));

export const patchReview = (id, { recipient, title, status } = {}) => attempt(async () => {
  if (status !== undefined && !['open', 'closed'].includes(status)) throw invalid('status must be open or closed');
  if (recipient && !(await sessionCheckout(recipient))) throw new Refusal('RECIPIENT_UNKNOWN', `unknown session: ${recipient}`);
  const res = await store.mutate(id, (review) => {
    if (recipient !== undefined) review.recipient = recipient || null;
    if (typeof title === 'string' && title.trim()) review.title = title.trim();
    if (status) review.status = status;
    return { ok: true };
  });
  return res.ok ? summaryById(id) : res;
});

export const deleteReview = (id) => attempt(() => withLock(id, async () => {
  if (!store.read(id)) return refuse('REVIEW_UNKNOWN', `unknown review: ${id}`);
  store.remove(id);
  return { ok: true };
}));

export const setVerdict = (id, hunkId, verdict) => attempt(async () => {
  const res = await inReview(id, async (review, env) => {
    if (!VERDICTS.includes(verdict)) throw invalid(`verdict must be one of ${VERDICTS.join(', ')}`);
    assertOpen(review);
    if (review.kind === 'uncommitted') throw new Refusal('NO_VERDICTS', 'uncommitted reviews carry no verdicts');
    const known = (await env.snapshot()).files.some((f) => f.hunks.some((h) => h.id === hunkId));
    if (!known) throw new Refusal('HUNK_UNKNOWN', `no such hunk in round ${currentRound(review).n}: ${hunkId}`);
    record(review, hunkId, verdict);
    return { ok: true };
  });
  return res.ok ? { ...(await summaryById(id)), hunkId, verdict } : res;
});

/** Accepts the listed pending hunks of one file in one write; hunks with a verdict keep it. */
export const acceptFile = (id, file, hunkIds) => attempt(async () => {
  const res = await inReview(id, async (review, env) => {
    if (typeof file !== 'string' || !file) throw invalid('file must be a non-empty string');
    if (!Array.isArray(hunkIds) || !hunkIds.length || !hunkIds.every((h) => typeof h === 'string')) throw invalid('hunkIds must be a non-empty array of hunk ids');
    assertOpen(review);
    if (review.kind === 'uncommitted') throw new Refusal('NO_VERDICTS', 'uncommitted reviews carry no verdicts');
    const f = (await env.snapshot()).files.find((x) => x.path === file);
    if (!f) throw new Refusal('FILE_NOT_IN_DIFF', `${file} is not in the diff`);
    const unknown = hunkIds.find((h) => !f.hunks.some((x) => x.id === h));
    if (unknown) throw new Refusal('HUNK_UNKNOWN', `no such hunk in ${file} in round ${currentRound(review).n}: ${unknown}`);
    const accepted = [];
    for (const hunkId of hunkIds) {
      if (review.verdicts[hunkId]) continue; // also skips a repeated id
      record(review, hunkId, 'accepted');
      accepted.push(hunkId);
    }
    return { ok: true, accepted };
  });
  return res.ok ? { ...(await summaryById(id)), file, accepted: res.accepted } : res;
});

/** Re-snapshots a range or uncommitted review. */
export const refreshReview = (id) => attempt(async () => inReview(id, async (review, env) => {
  assertOpen(review);
  if (review.kind === 'commit') throw new Refusal('IMMUTABLE_TARGET', 'a commit review cannot be refreshed; review the new commit instead');
  const co = await env.checkout();
  if (!co.exists) throw new Refusal('CHECKOUT_GONE', `${co.path ?? 'the checkout'} no longer exists`);
  const cur = currentRound(review);
  const shas = await resolveTarget(co.place, review.kind, review.target);
  const zero = { moved: 0, drifted: 0, outdated: 0, dropped: 0 };
  const push = (snap) => review.rounds.push({ n: cur.n + 1, ...shas, fingerprint: snap.fingerprint, createdAt: now(), submittedAt: null });

  if (review.kind === 'uncommitted') {
    const snap = await env.snapshot();
    if (snap.fingerprint === cur.fingerprint) return { ok: true, unchanged: true, round: cur.n };
    push(snap);
    return { ok: true, unchanged: false, round: cur.n + 1, hunks: { kept: 0, reset: 0, new: 0 }, threads: env.sweep ?? zero };
  }

  if (shas.headSha === cur.headSha && shas.baseSha === cur.baseSha) return { ok: true, unchanged: true, round: cur.n };
  const next = await buildSnapshot({ kind: 'range', repo: co.place, checkout: co.place, ...shas });
  const nextIds = new Set(next.files.flatMap((f) => f.hunks.map((h) => h.id)));
  let prevIds = new Set();
  try { prevIds = new Set((await env.snapshot()).files.flatMap((f) => f.hunks.map((h) => h.id))); } catch (e) {
    if (!(e instanceof Refusal)) throw e;
  }
  const hunks = { kept: 0, reset: 0, new: [...nextIds].filter((h) => !prevIds.has(h)).length };
  for (const hunkId of Object.keys(review.verdicts)) {
    if (nextIds.has(hunkId)) hunks.kept++;
    else { delete review.verdicts[hunkId]; hunks.reset++; }
  }
  let renames = {};
  try { renames = await git.renames(co.place, cur.headSha, shas.headSha); } catch { /* previous head gone: threads fall back to same-path lookup */ }
  const threads = await followThreads(review, next, 'reanchor', { renames, round: cur.n + 1 });
  push(next);
  return { ok: true, unchanged: false, round: cur.n + 1, hunks, threads };
}));

const withThreads = (review, file) => review.threads.filter((t) => t.status !== 'outdated' && t.anchor.file === file).map(threadView);

/** Files with hunks and threads for the whole review, one file, or (read-only) one commit or one past round of a range. */
export const diff = (id, { file, commit, round } = {}) => attempt(() => viewReview(id, async (review, env) => {
  if (round !== undefined) {
    if (commit) throw invalid('the commit filter and a round cannot be combined');
    return roundDiff(review, env, { file, round });
  }
  if (commit) {
    if (review.kind !== 'range') throw invalid('the commit filter applies to range reviews only');
    const repo = await env.repo();
    const cur = currentRound(review);
    const hit = (await git.commitLog(repo, { range: `${cur.baseSha}..${cur.headSha}` })).find((c) => commit.length >= 7 && c.sha.startsWith(commit));
    if (!hit) throw new Refusal('COMMIT_NOT_IN_RANGE', `${commit} is not in round ${cur.n}'s range`);
    const snap = await buildSnapshot({ kind: 'commit', repo, checkout: repo, ...(await resolveTarget(repo, 'commit', { sha: hit.sha })) });
    const bare = { ...review, kind: 'commit', threads: [], verdicts: {} };
    const states = fileStates(bare, snap.files).map((s, i) => ({ ...s, verdicts: null, hunks: snap.files[i].hunks.map((h) => ({ ...h, verdict: null })), threads: [] }));
    return { ok: true, readOnly: true, commit: { sha: hit.sha, subject: hit.subject }, files: states };
  }
  const summary = await summaryOf(review, env);
  if (summary.snapshotError) throw new Refusal(summary.snapshotError, 'the diff is unavailable');
  const snap = await env.snapshot();
  const picked = file ? snap.files.filter((f) => f.path === file) : snap.files;
  if (file && !picked.length) throw new Refusal('FILE_NOT_IN_DIFF', `${file} is not in the diff`);
  const states = fileStates(review, picked);
  return {
    ok: true, review: summary,
    files: states.map((s, i) => ({ ...s, hunks: picked[i].hunks.map((h) => hunkView(review, h)), threads: withThreads(review, s.path) })),
  };
}));

/** Commits of the current round (newest first). */
export const commits = (id) => attempt(() => viewReview(id, async (review, env) => {
  if (review.kind === 'uncommitted') return { ok: true, commits: [] };
  const cur = currentRound(review);
  const range = review.kind === 'range' ? `${cur.baseSha}..${cur.headSha}` : `${cur.headSha}^!`;
  return { ok: true, commits: await git.commitLog(await env.repo(), { range }) };
}));

/** A window of one side of a file (in the current round, or a given round of a range), for context expansion and citation jumps. */
export const fileLines = (id, { path, side = 'new', start, end, round } = {}) => attempt(() => viewReview(id, async (review, env) => {
  if (!path) throw invalid('path is required');
  if (!['old', 'new'].includes(side)) throw invalid('side must be old or new');
  const snap = await env.snapshot(round === undefined ? undefined : pickRound(review, round).n);
  let content;
  const read = async () => (content ??= (await snap.lines(side, path)) ?? false) || null;
  if (await isBinaryFile(snap, path, read)) throw new Refusal('BINARY_FILE', `${path} is binary`);
  const all = await read();
  if (!all) throw new Refusal('FILE_NOT_IN_DIFF', `${path} does not exist on the ${side} side`);
  const from = start === undefined ? 1 : Number(start);
  const to = end === undefined ? all.length : Number(end);
  if (!Number.isInteger(from) || !Number.isInteger(to)) throw invalid('start and end must be integers');
  if (from < 1 || to > all.length || from > to) throw new Refusal('LINE_OUT_OF_RANGE', `${path} has ${all.length} lines`);
  return { ok: true, path, side, total: all.length, lines: all.slice(from - 1, to).map((text, i) => ({ n: from + i, text })) };
}));

/** Hunks by id, or by file (+ a new-side line), with their verdict and the threads anchored to them. */
export const getHunks = (id, { hunk, file, line } = {}) => attempt(() => viewReview(id, async (review, env) => {
  if (!hunk && !file) throw invalid('give hunk, or file (optionally with line)');
  const files = (await env.snapshot()).files;
  let picked;
  if (hunk) {
    const f = files.find((x) => x.hunks.some((h) => h.id === hunk));
    if (!f) throw new Refusal('HUNK_UNKNOWN', `no such hunk: ${hunk}`);
    picked = { f, hunks: f.hunks.filter((h) => h.id === hunk) };
  } else {
    const f = files.find((x) => x.path === file);
    if (!f) throw new Refusal('FILE_NOT_IN_DIFF', `${file} is not in the diff`);
    const hit = line === undefined ? f.hunks : f.hunks.filter((h) => h.kind === 'text' && h.newLines > 0 && line >= h.newStart && line < h.newStart + h.newLines);
    if (!hit.length) throw new Refusal('HUNK_UNKNOWN', `no hunk of ${file} covers new-side line ${line}`);
    picked = { f, hunks: hit };
  }
  return {
    ok: true, file: picked.f.path,
    hunks: picked.hunks.map((h) => ({
      hunk: h, verdict: hunkView(review, h).verdict,
      threadIds: review.threads.filter((t) => t.status !== 'outdated' && t.anchor.hunkId === h.id).map((t) => t.id),
    })),
  };
}));
