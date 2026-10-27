import { createHash } from 'node:crypto';
import { parseCitations } from './citations.js';
import { currentRound, recipientRole } from './context.js';
import { anchorView } from './anchor.js';

export const verdictOf = (review, hunkId) => review.verdicts[hunkId]?.verdict ?? 'pending';

/** Non-human messages the human has not read yet. */
export const unreadOf = (t) => t.messages.filter((m) => m.author.kind !== 'human' && m.seq > t.humanReadSeq).length;

export const tally = (threads) => ({
  open: threads.filter((t) => t.status === 'open').length,
  resolved: threads.filter((t) => t.status === 'resolved').length,
  outdated: threads.filter((t) => t.status === 'outdated').length,
});

const verdictTally = (review, hunks) => {
  const c = { pending: 0, accepted: 0, rejected: 0 };
  for (const h of hunks) c[verdictOf(review, h.id)]++;
  return c;
};

export const targetLabel = (review) => {
  if (review.kind === 'range') return `${review.baseLabel}...${review.branch}`;
  if (review.kind === 'commit') return `commit ${review.target.sha.slice(0, 7)}`;
  return 'uncommitted changes';
};

/** [FileState] for a snapshot's files. */
export function fileStates(review, files) {
  const verdicts = review.kind !== 'uncommitted';
  return files.map((f) => {
    const threads = review.threads.filter((t) => t.anchor.file === f.path);
    return {
      path: f.path, oldPath: f.oldPath, status: f.status, binary: f.binary, tooLarge: Boolean(f.tooLarge),
      additions: f.additions, deletions: f.deletions, hunks: f.hunks.length,
      verdicts: verdicts ? verdictTally(review, f.hunks) : null,
      threads: tally(threads),
      unread: threads.reduce((n, t) => n + unreadOf(t), 0),
    };
  });
}

/** Rejected hunks + open question threads: what the conductor holds a merge on. */
export function mergeBlockers(review, files) {
  const questions = review.threads.filter((t) => t.kind === 'question' && t.status === 'open').length;
  if (review.kind === 'uncommitted') return questions;
  const rejected = files
    ? files.flatMap((f) => f.hunks).filter((h) => verdictOf(review, h.id) === 'rejected').length
    : Object.values(review.verdicts).filter((v) => v.verdict === 'rejected').length;
  return rejected + questions;
}

/** ReviewSummary. `files` is null when the snapshot is unreadable (`live.snapshotError` says why). */
export function summarize(review, files, live) {
  const round = currentRound(review);
  const last = review.submissions[review.submissions.length - 1];
  const hunks = files?.flatMap((f) => f.hunks) ?? null;
  let hunkCounts = null;
  if (hunks) hunkCounts = review.kind === 'uncommitted' ? { total: hunks.length } : verdictTally(review, hunks);
  return {
    id: review.id, project: review.project, worktree: review.worktree, branch: review.branch,
    kind: review.kind, target: review.target, label: targetLabel(review), title: review.title, status: review.status,
    recipient: review.recipient, author: review.author, recipientRole: recipientRole(review),
    round: round.n, headSha: round.headSha, baseSha: round.baseSha,
    headMoved: live.headMoved, dirty: live.dirty, checkoutGone: live.checkoutGone,
    ...(live.snapshotError ? { snapshotError: live.snapshotError } : {}),
    counts: { files: files?.length ?? null, hunks: hunkCounts, threads: tally(review.threads) },
    mergeBlockers: mergeBlockers(review, files),
    unread: review.threads.reduce((n, t) => n + unreadOf(t), 0),
    seenByHuman: review.seenByHuman, rev: review.rev, createdAt: review.createdAt, createdBy: review.createdBy,
    lastSubmission: last ? { id: last.id, status: last.status, code: last.code, round: last.round } : null,
  };
}

/** Thread as the API shows it. */
export function threadView(t) {
  return {
    id: t.id, kind: t.kind, severity: t.severity, status: t.status, disposition: t.disposition,
    resolveProposed: t.resolveProposed, anchor: anchorView(t.anchor),
    openedBy: t.openedBy, unread: unreadOf(t),
    messages: t.messages.map((m) => ({
      id: m.id, author: m.author, body: m.body, at: m.at, round: m.round, proposeResolve: m.proposeResolve,
      citations: parseCitations(m.body),
    })),
  };
}

/** Hunk as the API shows it (`verdict` null when verdicts do not apply). */
export const hunkView = (review, h, withVerdict = true) => ({ ...h, verdict: withVerdict && review.kind !== 'uncommitted' ? verdictOf(review, h.id) : null });

/** The non-outdated threads on one file, as the live diff shows them. */
export const withThreads = (review, file) => review.threads.filter((t) => t.status !== 'outdated' && t.anchor.file === file).map(threadView);

/** How the live (current-round, writable) views render a file's hunks and threads. */
export const liveView = (review) => ({ hunk: (h) => hunkView(review, h), threads: (path) => withThreads(review, path) });

/**
 * A file's `sig`: a hash of its content (`contentHash`), its FileState, its hunks' verdicts and its threads, each as the
 * view renders them. Equal sigs mean an identical file in that view's diff; anything shown that changes, changes it.
 */
export function fileSig(contentHash, state, verdicts, threads) {
  return createHash('sha256').update(`${contentHash}\0`).update(JSON.stringify([state, verdicts, threads])).digest('hex').slice(0, 20);
}

const sigOf = (snap, state, f, view) => fileSig(snap.contentHash(state.path), state, f.hunks.map((h) => view.hunk(h).verdict), view.threads(state.path));

/** FileStates (`states`, one per `files` entry of `snap`) with their `sig` in `view` ({hunk(h), threads(path)}). */
export const signStates = (snap, states, files, view) => states.map((s, i) => ({ ...s, sig: sigOf(snap, s, files[i], view) }));

/** DiffFiles: each FileState with its hunks and threads as `view` renders them, `lineCount` and `sig`. */
export async function diffFiles(snap, states, files, view) {
  const counts = await snap.lineCounts(files);
  return states.map((s, i) => ({
    ...s, hunks: files[i].hunks.map(view.hunk), threads: view.threads(s.path), lineCount: counts[i], sig: sigOf(snap, s, files[i], view),
  }));
}

/** `{path, sig}` of one file of the live diff after a write; `sig` null when the file is not in it or there is no snapshot. */
export function liveSig(review, snap, path) {
  const f = snap?.files.find((x) => x.path === path);
  return { path, sig: f ? signStates(snap, fileStates(review, [f]), [f], liveView(review))[0].sig : null };
}

/**
 * Whose move a review waits on: 'agent' when the newest submission was delivered and no agent has written or refreshed into a
 * new round since it was composed; else 'human'. Compose supersedes older pending and failed submissions, so the last is the live one.
 */
export function turnOf(review) {
  const last = review.submissions[review.submissions.length - 1];
  return last?.status === 'delivered' && review.agentSeq <= last.seq ? 'agent' : 'human';
}

/** InboxItem: a stored review as the inbox lists it. `checkoutGone` is true, false or null (cc could not say). */
export const inboxItem = (review, checkoutGone) => ({
  id: review.id, project: review.project, worktree: review.worktree, branch: review.branch,
  kind: review.kind, label: targetLabel(review), title: review.title, round: currentRound(review).n,
  unread: review.threads.reduce((n, t) => n + unreadOf(t), 0), seenByHuman: review.seenByHuman,
  lastActivityAt: review.lastActivityAt, turn: turnOf(review), checkoutGone,
});
