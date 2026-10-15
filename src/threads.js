import { makeAnchor } from './anchor.js';
import { attempt, Refusal } from './refusals.js';
import { authorFor, assertOpen, currentRound, inReview } from './context.js';
import { threadView } from './rollup.js';
import { bump, summaryById } from './reviews.js';

const KINDS = ['comment', 'question', 'suggestion', 'finding'];
const SEVERITIES = ['blocker', 'major', 'minor', 'nit'];
const DISPOSITIONS = ['fixed', 'dismissed'];
const now = () => new Date().toISOString();
const invalid = (reason) => new Refusal('INVALID_ARGUMENT', reason);

function needBody(body) {
  if (typeof body !== 'string' || !body.trim()) throw invalid('body is required');
  return body;
}

function findThread(review, tid) {
  const t = review.threads.find((x) => x.id === tid);
  if (t) return t;
  if (review.droppedThreads.includes(tid)) throw new Refusal('THREAD_DROPPED', `thread ${tid} followed lines that no longer exist and was dropped`);
  throw new Refusal('THREAD_UNKNOWN', `unknown thread: ${tid}`);
}

const isOpener = (thread, actor) => actor.kind === 'agent' && thread.openedBy.sessionId === actor.sessionId;

// {file, side, startLine, endLine} or {hunkId} -> a complete anchor against the current snapshot.
async function buildAnchor(review, snap, spec) {
  if (!spec || typeof spec !== 'object') throw invalid('anchor is required');
  let file;
  let side = spec.side ?? 'new';
  let startLine = spec.startLine;
  let endLine = spec.endLine ?? spec.startLine;
  if (spec.hunkId) {
    file = snap.files.find((f) => f.hunks.some((h) => h.id === spec.hunkId));
    if (!file) throw new Refusal('HUNK_UNKNOWN', `no such hunk: ${spec.hunkId}`);
    const hunk = file.hunks.find((h) => h.id === spec.hunkId);
    if (file.binary || file.tooLarge) throw new Refusal('BINARY_FILE', `${file.path} has no lines to anchor to`);
    if (hunk.kind !== 'text') throw invalid(`${file.path} has no changed lines to anchor to`);
    side = hunk.newLines > 0 ? 'new' : 'old';
    startLine = side === 'new' ? hunk.newStart : hunk.oldStart;
    endLine = startLine + (side === 'new' ? hunk.newLines : hunk.oldLines) - 1;
  } else {
    if (!['old', 'new'].includes(side)) throw invalid('side must be old or new');
    file = snap.files.find((f) => f.path === spec.file);
    if (!file) throw new Refusal('FILE_NOT_IN_DIFF', `${spec.file} is not in the diff`);
    if (file.binary || file.tooLarge) throw new Refusal('BINARY_FILE', `${file.path} has no lines to anchor to`);
    if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || startLine > endLine) throw invalid('startLine and endLine must be integers with 1 <= startLine <= endLine');
  }
  const fileLines = await snap.lines(side, file.path);
  if (!fileLines) throw new Refusal('FILE_NOT_IN_DIFF', `${file.path} does not exist on the ${side} side`);
  if (endLine > fileLines.length) throw new Refusal('LINE_OUT_OF_RANGE', `${file.path} has ${fileLines.length} lines on the ${side} side`);
  return makeAnchor({ file: file.path, side, startLine, endLine, round: currentRound(review).n, fileLines, hunks: file.hunks });
}

function message(review, actor, body, extra = {}) {
  const seq = bump(review);
  return {
    id: `m${seq}`, seq, author: authorFor(review, actor), body, at: now(),
    round: currentRound(review).n, proposeResolve: false, ...extra,
  };
}

/** Starts a thread on lines or on a whole hunk. */
export const annotate = (id, actor, { anchor, kind, severity, body }) => attempt(() => inReview(id, async (review, env) => {
  assertOpen(review);
  if (!KINDS.includes(kind)) throw invalid(`kind must be one of ${KINDS.join(', ')}`);
  if (kind === 'finding' && !SEVERITIES.includes(severity)) throw new Refusal('SEVERITY_REQUIRED', `a finding needs a severity: ${SEVERITIES.join(', ')}`);
  needBody(body);
  const built = await buildAnchor(review, await env.snapshot(), anchor);
  const first = message(review, actor, body);
  const thread = {
    id: `t${review.nextThread++}`, kind, severity: kind === 'finding' ? severity : null, status: 'open', disposition: null,
    resolution: null, resolveProposed: false, statusSeq: first.seq, openedBy: first.author, anchor: built,
    humanReadSeq: actor.kind === 'human' ? first.seq : 0, createdAt: now(), messages: [first],
  };
  review.threads.push(thread);
  return { ok: true, thread: threadView(thread) };
}));

/** Adds a message. `resolve` closes the caller's own non-finding thread, otherwise it proposes resolution. */
export const reply = (id, actor, tid, { body, resolve = false }) => attempt(() => inReview(id, async (review) => {
  assertOpen(review);
  needBody(body);
  const thread = findThread(review, tid);
  const msg = message(review, actor, body);
  if (actor.kind === 'human') thread.humanReadSeq = msg.seq;
  else if (resolve) {
    if (isOpener(thread, actor) && thread.kind !== 'finding' && thread.status !== 'outdated') {
      thread.status = 'resolved';
      thread.resolution = { by: msg.author, seq: msg.seq };
      thread.statusSeq = msg.seq;
      thread.resolveProposed = false;
    } else {
      msg.proposeResolve = true;
      thread.resolveProposed = true;
    }
  }
  thread.messages.push(msg);
  return { ok: true, thread: threadView(thread) };
}));

/** Human-only: resolve (a finding needs a disposition) or reopen. */
export const setThreadStatus = (id, tid, { status, disposition } = {}) => attempt(() => inReview(id, async (review) => {
  assertOpen(review);
  const thread = findThread(review, tid);
  if (!['resolved', 'open'].includes(status)) throw invalid('status must be resolved or open');
  if (thread.status === 'outdated') throw invalid('an outdated thread cannot change status');
  if (status === 'resolved' && thread.kind === 'finding' && !DISPOSITIONS.includes(disposition)) {
    throw invalid(`resolving a finding needs a disposition: ${DISPOSITIONS.join(', ')}`);
  }
  const seq = bump(review);
  thread.status = status;
  thread.statusSeq = seq;
  thread.resolveProposed = false;
  thread.humanReadSeq = seq;
  if (status === 'resolved') {
    thread.disposition = thread.kind === 'finding' ? disposition : null;
    thread.resolution = { by: { kind: 'human' }, seq };
  } else {
    thread.disposition = null;
    thread.resolution = null;
  }
  return { ok: true, thread: threadView(thread) };
}));

/** Marks one thread, or (no threadId) the whole review, as read by the human. */
export const markRead = (id, { threadId } = {}) => attempt(async () => {
  const res = await inReview(id, async (review) => {
    if (threadId) findThread(review, threadId).humanReadSeq = review.seq;
    else {
      review.seenByHuman = true;
      for (const t of review.threads) t.humanReadSeq = review.seq;
    }
    return { ok: true };
  });
  return res.ok ? summaryById(id) : res;
});
