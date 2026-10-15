import { parseCitations } from './citations.js';
import { currentRound } from './context.js';

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
    recipient: review.recipient, recipientRole: review.recipient ? (review.kind === 'uncommitted' ? 'reviewer' : 'author') : null,
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
  const { file, side, startLine, endLine, hunkId, round, linesHash, drifted } = t.anchor;
  return {
    id: t.id, kind: t.kind, severity: t.severity, status: t.status, disposition: t.disposition,
    resolveProposed: t.resolveProposed, anchor: { file, side, startLine, endLine, hunkId, round, linesHash, drifted },
    openedBy: t.openedBy, unread: unreadOf(t),
    messages: t.messages.map((m) => ({
      id: m.id, author: m.author, body: m.body, at: m.at, round: m.round, proposeResolve: m.proposeResolve,
      citations: parseCitations(m.body),
    })),
  };
}

/** Hunk as the API shows it (`verdict` null when verdicts do not apply). */
export const hunkView = (review, h, withVerdict = true) => ({ ...h, verdict: withVerdict && review.kind !== 'uncommitted' ? verdictOf(review, h.id) : null });
