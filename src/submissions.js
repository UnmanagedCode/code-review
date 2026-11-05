import { attempt, Refusal } from './refusals.js';
import { assertOpen, currentRound, inReview, recipientRole } from './context.js';
import { renderPrompt, renderGuidePrompt } from './prompt.js';
import { verdictOf } from './rollup.js';
import { touch } from './reviews.js';
import { anchorLabel } from './anchor.js';
import { groupCounts, guideState } from './grouping.js';

const BRIDGE_CODES = ['INVALID_ARGUMENT', 'SESSION_UNKNOWN', 'SESSION_NOT_LIVE', 'SESSION_NOT_READY', 'SEND_FAILED', 'LOOKUP_FAILED', 'HOST_ERROR'];
const now = () => new Date().toISOString();

// A human status change takes its own seq; opening and agent resolves share the seq of a message.
const humanChangedStatus = (t, since) => t.statusSeq > since && !t.messages.some((m) => m.seq === t.statusSeq);

function activeThreads(review, since) {
  const out = [];
  for (const t of review.threads) {
    const human = t.messages.filter((m) => m.author.kind === 'human');
    const newMsg = human.some((m) => m.seq > since);
    if (!newMsg && !humanChangedStatus(t, since)) continue;
    const latest = human[human.length - 1];
    const note = latest ? latest.body.split('\n')[0] : '';
    const state = t.status === 'open' ? 'reopened' : `${t.status}${t.disposition ? ` (${t.disposition})` : ''}`;
    out.push({ id: t.id, kind: t.kind, where: anchorLabel(t.anchor), note: humanChangedStatus(t, since) ? `${state}${note ? ` — ${note}` : ''}` : note });
  }
  return out;
}

// Where each hunk id sits, for the prompt; a file that can no longer be read says so.
async function describeHunks(env, ids) {
  if (!ids.length) return [];
  let files = [];
  try { files = (await env.snapshot()).files; } catch (e) { if (!(e instanceof Refusal)) throw e; }
  return ids.map((id) => {
    const f = files.find((x) => x.hunks.some((h) => h.id === id));
    const h = f?.hunks.find((x) => x.id === id);
    return { id, path: f?.path ?? '(file no longer readable)', header: h?.kind === 'text' ? h.header : '(file-level change)' };
  });
}

/** Groups the human decided since `since`, and the rejected hunks no listed rejected group already covers. */
async function verdictsSince(review, env, since) {
  const decided = (verdict) => review.groups.filter((g) => g.verdict?.verdict === verdict && g.verdict.seq > since);
  const rejectedGroups = decided('rejected');
  const covered = new Set(rejectedGroups.flatMap((g) => g.hunkIds));
  const ids = Object.entries(review.verdicts).filter(([id, v]) => v.verdict === 'rejected' && v.seq > since && !covered.has(id)).map(([id]) => id);
  return {
    groups: {
      accepted: decided('accepted').map((g) => ({ id: g.id, title: g.title, hunks: g.hunkIds.length })),
      rejected: await Promise.all(rejectedGroups.map(async (g) => ({ id: g.id, title: g.title, hunks: await describeHunks(env, g.hunkIds) }))),
    },
    rejected: await describeHunks(env, ids),
  };
}

// Stores a composed submission; it supersedes every pending or failed one, so the last submission is the live one.
function storeSubmission(review, kind, text) {
  for (const s of review.submissions) if (s.status === 'pending' || s.status === 'failed') s.status = 'superseded';
  const round = currentRound(review);
  const submission = {
    id: `s${review.nextSubmission++}`, round: round.n, seq: review.seq, recipient: review.recipient, text, kind,
    status: 'pending', code: null, composedAt: now(), deliveredAt: null,
  };
  review.submissions.push(submission);
  touch(review);
  return { ok: true, submission: { id: submission.id, round: submission.round, recipient: submission.recipient, text, status: submission.status, kind } };
}

const labelOf = (review) => (review.kind === 'range' ? `${review.baseLabel}...${review.branch}` : review.kind === 'commit' ? `commit ${review.target.sha.slice(0, 7)}` : 'uncommitted changes');

/** Composes the next round prompt for the recipient and records it as pending. */
export const composeSubmission = (id) => attempt(() => inReview(id, async (review, env) => {
  assertOpen(review);
  if (!review.recipient) throw new Refusal('NO_RECIPIENT', 'no recipient session: choose one before submitting');
  const lastDelivered = [...review.submissions].reverse().find((s) => s.kind === 'round' && s.status === 'delivered');
  const since = lastDelivered?.seq ?? 0;
  if (lastDelivered && review.humanSeq <= since) throw new Refusal('NOTHING_TO_SUBMIT', 'nothing changed since the last delivered submission');
  const round = currentRound(review);
  const uncommitted = review.kind === 'uncommitted';
  let files = null;
  if (uncommitted) {
    try { files = (await env.snapshot()).files.map((f) => f.path); } catch (e) { if (!(e instanceof Refusal)) throw e; }
  }
  const tally = { pending: 0, accepted: 0, rejected: 0 };
  if (!uncommitted) {
    try {
      for (const f of (await env.snapshot()).files) for (const h of f.hunks) tally[verdictOf(review, h.id)]++;
    } catch (e) { if (!(e instanceof Refusal)) throw e; }
  }
  const text = renderPrompt({
    id: review.id, round: round.n, project: review.project, worktree: review.worktree, label: labelOf(review),
    role: recipientRole(review), uncommitted, author: review.author ?? null, tally,
    ...(uncommitted ? { groups: { accepted: [], rejected: [] }, rejected: [] } : await verdictsSince(review, env, since)),
    threads: activeThreads(review, since), files,
  });
  return storeSubmission(review, 'round', text);
}));

/** Composes the Guide me prompt (asks the recipient to group the round) and records it as pending. */
export const composeGuide = (id) => attempt(() => inReview(id, async (review, env) => {
  assertOpen(review);
  if (review.kind === 'uncommitted') throw new Refusal('NO_GROUPS', 'uncommitted reviews have no groups');
  if (!review.recipient) throw new Refusal('NO_RECIPIENT', 'no recipient session: choose one before submitting');
  let files = null;
  try { files = (await env.snapshot()).files; } catch (e) { if (!(e instanceof Refusal)) throw e; }
  const state = guideState(review);
  const text = renderGuidePrompt({
    id: review.id, round: currentRound(review).n, project: review.project, worktree: review.worktree, label: labelOf(review),
    role: recipientRole(review), author: review.author ?? null,
    groups: review.groups.length, dropped: state.droppedGroups, newUngrouped: state.newUngrouped, ungrouped: groupCounts(review, files).ungrouped,
  });
  return storeSubmission(review, 'guide', text);
}));

/** Records the UI's report of sending a submission through the bridge. */
export const recordResult = (id, sid, { ok, code } = {}) => attempt(() => inReview(id, async (review) => {
  if (typeof ok !== 'boolean') throw new Refusal('INVALID_ARGUMENT', 'ok must be a boolean');
  if (!ok && !BRIDGE_CODES.includes(code)) throw new Refusal('INVALID_ARGUMENT', `code must be one of ${BRIDGE_CODES.join(', ')}`);
  const sub = review.submissions.find((s) => s.id === sid);
  if (!sub) throw new Refusal('SUBMISSION_UNKNOWN', `unknown submission: ${sid}`);
  if (sub.status !== 'pending' && sub.status !== 'failed') throw new Refusal('SUBMISSION_NOT_PENDING', `submission ${sid} is ${sub.status}`);
  if (ok) {
    sub.status = 'delivered';
    sub.code = null;
    sub.deliveredAt = now();
    if (sub.kind === 'round') review.rounds.find((r) => r.n === sub.round).submittedAt ??= sub.deliveredAt;
  } else {
    sub.status = 'failed';
    sub.code = code;
  }
  touch(review);
  return { ok: true, submission: { id: sub.id, round: sub.round, recipient: sub.recipient, text: sub.text, status: sub.status, code: sub.code, kind: sub.kind } };
}));
