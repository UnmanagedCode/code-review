import { attempt, Refusal } from './refusals.js';
import { assertOpen, currentRound, inReview, recipientRole } from './context.js';
import { renderPrompt } from './prompt.js';
import { verdictOf } from './rollup.js';
import { touch } from './reviews.js';
import { anchorLabel } from './anchor.js';

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

async function rejectedHunks(review, env, since) {
  const ids = Object.entries(review.verdicts).filter(([, v]) => v.verdict === 'rejected' && v.seq > since).map(([id]) => id);
  if (!ids.length) return [];
  let files = [];
  try { files = (await env.snapshot()).files; } catch (e) { if (!(e instanceof Refusal)) throw e; }
  return ids.map((id) => {
    const f = files.find((x) => x.hunks.some((h) => h.id === id));
    const h = f?.hunks.find((x) => x.id === id);
    return { id, path: f?.path ?? '(file no longer readable)', header: h?.kind === 'text' ? h.header : '(file-level change)' };
  });
}

/** Composes the next prompt for the recipient and records it as pending. */
export const composeSubmission = (id) => attempt(() => inReview(id, async (review, env) => {
  assertOpen(review);
  if (!review.recipient) throw new Refusal('NO_RECIPIENT', 'no recipient session: choose one before submitting');
  const lastDelivered = [...review.submissions].reverse().find((s) => s.status === 'delivered');
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
    id: review.id, round: round.n, project: review.project, worktree: review.worktree,
    label: `${review.kind === 'range' ? `${review.baseLabel}...${review.branch}` : review.kind === 'commit' ? `commit ${review.target.sha.slice(0, 7)}` : 'uncommitted changes'}`,
    role: recipientRole(review), uncommitted, author: review.author ?? null, tally,
    rejected: uncommitted ? [] : await rejectedHunks(review, env, since),
    threads: activeThreads(review, since), files,
  });
  for (const s of review.submissions) if (s.status === 'pending' || s.status === 'failed') s.status = 'superseded';
  const submission = {
    id: `s${review.nextSubmission++}`, round: round.n, seq: review.seq, recipient: review.recipient, text,
    status: 'pending', code: null, composedAt: now(), deliveredAt: null,
  };
  review.submissions.push(submission);
  touch(review);
  return { ok: true, submission: { id: submission.id, round: submission.round, recipient: submission.recipient, text, status: submission.status } };
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
    const round = review.rounds.find((r) => r.n === sub.round);
    round.submittedAt ??= sub.deliveredAt;
  } else {
    sub.status = 'failed';
    sub.code = code;
  }
  touch(review);
  return { ok: true, submission: { id: sub.id, round: sub.round, recipient: sub.recipient, text: sub.text, status: sub.status, code: sub.code } };
}));
