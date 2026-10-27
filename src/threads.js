import { makeAnchor } from './anchor.js';
import { attempt, Refusal } from './refusals.js';
import { authorFor, assertOpen, currentRound, inReview, viewReview } from './context.js';
import { threadView, tally, liveSig } from './rollup.js';
import { citationsForMessage } from './citations.js';
import { bump, summaryById } from './reviews.js';
import { isBinaryFile } from './snapshot.js';
import { isConductorProject } from './checkouts.js';

const KINDS = ['comment', 'question', 'suggestion', 'finding'];
const SEVERITIES = ['blocker', 'major', 'minor', 'nit'];
const DISPOSITIONS = ['fixed', 'dismissed'];
const now = () => new Date().toISOString();
const invalid = (reason) => new Refusal('INVALID_ARGUMENT', reason);

export const MAX_BODY_CHARS = 20000;

function needBody(body) {
  if (typeof body !== 'string' || !body.trim()) throw invalid('body is required');
  if (body.length > MAX_BODY_CHARS) throw new Refusal('BODY_TOO_LARGE', `a message body is limited to ${MAX_BODY_CHARS} characters`);
  return body;
}

function findThread(review, tid) {
  const t = review.threads.find((x) => x.id === tid);
  if (t) return t;
  if (review.droppedThreads.includes(tid)) throw new Refusal('THREAD_DROPPED', `thread ${tid} followed lines that no longer exist and was dropped`);
  throw new Refusal('THREAD_UNKNOWN', `unknown thread: ${tid}`);
}

// The conductor and a thread's opening agent close an agent-opened thread. Only an open thread closes: an agent never overrides a human's close, and an outdated thread is frozen.
const closer = (thread, actor) => isConductorProject(actor.project) || thread.openedBy.sessionId === actor.sessionId;
const mayClose = (thread, actor) => thread.status === 'open' && thread.openedBy.kind === 'session' && closer(thread, actor);

// Annotated files are always in the diff, so the binary decision never needs their content.
const noContent = async () => null;

// What each anchor kind takes besides `kind`, and what it needs. A hunk anchor is stored as a lines anchor.
const ANCHOR_KINDS = {
  lines: { takes: ['file', 'side', 'startLine', 'endLine'], needs: ['file', 'startLine'] },
  hunk: { takes: ['hunkId'], needs: ['hunkId'] },
  file: { takes: ['file'], needs: ['file'] },
  review: { takes: [], needs: [] },
};
// Spec keys in domain words, so one refusal reads the same over REST and MCP.
const WORDS = { file: 'file', startLine: 'lines', endLine: 'lines', side: 'side', hunkId: 'hunk' };
const words = (keys) => {
  const w = [...new Set(keys.map((k) => WORDS[k]))];
  return w.length > 1 ? `${w.slice(0, -1).join(', ')} or ${w.at(-1)}` : w[0];
};

/** Refuses an anchor spec whose kind is unknown, or that carries what its kind does not take or lacks what it needs. */
function checkSpec(spec) {
  if (!spec || typeof spec !== 'object') throw invalid('anchor is required');
  if (typeof spec.kind !== 'string' || !Object.hasOwn(ANCHOR_KINDS, spec.kind)) throw invalid(`anchor kind must be one of ${Object.keys(ANCHOR_KINDS).join(', ')}`);
  const kind = ANCHOR_KINDS[spec.kind];
  const foreign = Object.keys(WORDS).filter((k) => !kind.takes.includes(k));
  if (foreign.some((k) => spec[k] !== undefined)) throw invalid(`a ${spec.kind} anchor takes no ${words(foreign)}`);
  const lacking = kind.needs.filter((k) => spec[k] === undefined);
  if (lacking.length) throw invalid(`a ${spec.kind} anchor needs ${kind.needs.map((k) => WORDS[k]).join(' and ')}`);
}

// A checked spec -> a complete anchor; `snap` (the current snapshot) is null for a review anchor, which reads none.
async function buildAnchor(review, snap, spec) {
  const round = currentRound(review).n;
  if (spec.kind === 'review') return { kind: 'review', round };
  if (spec.kind === 'file') {
    const f = snap.files.find((x) => x.path === spec.file);
    if (!f) throw new Refusal('FILE_NOT_IN_DIFF', `${spec.file} is not in the diff`);
    return { kind: 'file', file: f.path, round };
  }
  let file;
  let side = spec.side ?? 'new';
  let startLine = spec.startLine;
  let endLine = spec.endLine ?? spec.startLine;
  if (spec.kind === 'hunk') {
    file = snap.files.find((f) => f.hunks.some((h) => h.id === spec.hunkId));
    if (!file) throw new Refusal('HUNK_UNKNOWN', `no such hunk: ${spec.hunkId}`);
    const hunk = file.hunks.find((h) => h.id === spec.hunkId);
    if (await isBinaryFile(snap, file.path, noContent)) throw new Refusal('BINARY_FILE', `${file.path} has no lines to anchor to`);
    if (hunk.kind !== 'text') throw invalid(`${file.path} has no changed lines to anchor to`);
    side = hunk.newLines > 0 ? 'new' : 'old';
    startLine = side === 'new' ? hunk.newStart : hunk.oldStart;
    endLine = startLine + (side === 'new' ? hunk.newLines : hunk.oldLines) - 1;
  } else {
    if (!['old', 'new'].includes(side)) throw invalid('side must be old or new');
    file = snap.files.find((f) => f.path === spec.file);
    if (!file) throw new Refusal('FILE_NOT_IN_DIFF', `${spec.file} is not in the diff`);
    if (await isBinaryFile(snap, file.path, noContent)) throw new Refusal('BINARY_FILE', `${file.path} has no lines to anchor to`);
    if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || startLine > endLine) throw invalid('startLine and endLine must be integers with 1 <= startLine <= endLine');
  }
  const fileLines = await snap.lines(side, file.path);
  if (!fileLines) throw new Refusal('FILE_NOT_IN_DIFF', `${file.path} does not exist on the ${side} side`);
  if (endLine > fileLines.length) throw new Refusal('LINE_OUT_OF_RANGE', `${file.path} has ${fileLines.length} lines on the ${side} side`);
  return makeAnchor({ file: file.path, side, startLine, endLine, round, fileLines, hunks: file.hunks });
}

/**
 * `{path, sig}` of the thread's file in the live diff after a write, from a snapshot this request already has
 * (uncommitted: the sweep's; committed: this process's cached one, else read). Never fails the write: `sig` null.
 * A review thread is on no file: null.
 */
async function sigAfterWrite(review, env, thread) {
  if (thread.anchor.kind === 'review') return null;
  const path = thread.anchor.file;
  let snap = null;
  try {
    if (review.kind === 'uncommitted') snap = env.sweep ? await env.snapshot() : null;
    else snap = (await env.cachedSnapshot()) ?? (await env.snapshot());
  } catch (e) {
    if (!(e instanceof Refusal)) console.warn(`code-review: no file sig for ${path} on review ${review.id}: ${e.message}`);
  }
  return liveSig(review, snap, path);
}

function message(review, actor, body, extra = {}) {
  const seq = bump(review);
  if (actor.kind === 'human') review.humanSeq = seq;
  else review.agentSeq = seq;
  return {
    id: `m${seq}`, seq, author: authorFor(review, actor), body, at: now(),
    round: currentRound(review).n, proposeResolve: false, ...extra,
  };
}

/** Starts a thread on lines, a whole hunk, a whole file or the review. */
export const annotate = (id, actor, { anchor, kind, severity, body }) => attempt(() => inReview(id, async (review, env) => {
  assertOpen(review);
  if (!KINDS.includes(kind)) throw invalid(`kind must be one of ${KINDS.join(', ')}`);
  if (kind === 'finding' && !SEVERITIES.includes(severity)) throw new Refusal('SEVERITY_REQUIRED', `a finding needs a severity: ${SEVERITIES.join(', ')}`);
  needBody(body);
  checkSpec(anchor);
  // Only a review anchor reads no snapshot, so it can be written while the diff is unreadable.
  const snap = anchor.kind === 'review' ? null : await env.snapshot();
  const built = await buildAnchor(review, snap, anchor);
  const first = message(review, actor, body);
  const thread = {
    id: `t${review.nextThread++}`, kind, severity: kind === 'finding' ? severity : null, status: 'open', disposition: null,
    resolution: null, resolveProposed: false, statusSeq: first.seq, openedBy: first.author, anchor: built, pastAnchors: [],
    humanReadSeq: actor.kind === 'human' ? first.seq : 0, createdAt: now(), messages: [first],
  };
  review.threads.push(thread);
  return { ok: true, thread: threadView(thread), fileSig: built.kind === 'review' ? null : liveSig(review, snap, built.file) };
}));

/** Adds a message. `resolve` closes a thread the caller may close (`mayClose`), otherwise it proposes resolution. */
export const reply = (id, actor, tid, { body, resolve = false, disposition }) => attempt(() => inReview(id, async (review, env) => {
  assertOpen(review);
  needBody(body);
  const thread = findThread(review, tid);
  const needsDisposition = () => invalid(`resolving a finding needs a disposition: ${DISPOSITIONS.join(', ')}`);
  let closes = false;
  if (actor.kind === 'agent') {
    if (disposition !== undefined) {
      if (!resolve || thread.kind !== 'finding' || !closer(thread, actor)) throw invalid('disposition is for resolving a finding you opened (the conductor: any agent\'s finding)');
      if (!DISPOSITIONS.includes(disposition)) throw needsDisposition();
    }
    closes = resolve && mayClose(thread, actor);
    if (closes && thread.kind === 'finding' && !disposition) throw needsDisposition();
  }
  const msg = message(review, actor, body);
  if (actor.kind === 'human') thread.humanReadSeq = msg.seq;
  else if (closes) {
    thread.status = 'resolved';
    thread.resolution = { by: msg.author, seq: msg.seq };
    thread.statusSeq = msg.seq;
    thread.resolveProposed = false;
    thread.disposition = thread.kind === 'finding' ? disposition : null;
  } else if (resolve) {
    msg.proposeResolve = true;
    thread.resolveProposed = true;
  }
  thread.messages.push(msg);
  return { ok: true, thread: threadView(thread), fileSig: await sigAfterWrite(review, env, thread) };
}));

/** Human-only: resolve (a finding needs a disposition) or reopen. */
export const setThreadStatus = (id, tid, { status, disposition } = {}) => attempt(() => inReview(id, async (review, env) => {
  assertOpen(review);
  const thread = findThread(review, tid);
  if (!['resolved', 'open'].includes(status)) throw invalid('status must be resolved or open');
  if (thread.status === 'outdated') throw invalid('an outdated thread cannot change status');
  if (status === 'resolved' && thread.kind === 'finding' && !DISPOSITIONS.includes(disposition)) {
    throw invalid(`resolving a finding needs a disposition: ${DISPOSITIONS.join(', ')}`);
  }
  const seq = bump(review);
  review.humanSeq = seq;
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
  return { ok: true, thread: threadView(thread), fileSig: await sigAfterWrite(review, env, thread) };
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

/** Threads (default: open ones) with their anchored text and every message's cited code resolved. */
export const listThreads = (id, { status = 'open', file, owner } = {}) => attempt(() => viewReview(id, async (review, env) => {
  if (!['open', 'resolved', 'outdated', 'all'].includes(status)) throw invalid('status must be open, resolved, outdated or all');
  if (owner !== undefined && !['user', 'agents'].includes(owner)) throw invalid('owner must be user or agents');
  const picked = review.threads.filter((t) => (status === 'all' || t.status === status) && (!file || t.anchor.file === file)
    && (!owner || (t.openedBy.kind === 'human') === (owner === 'user')));
  const out = [];
  for (const t of picked) {
    const view = threadView(t);
    out.push({
      ...view, anchorLines: t.anchor.kind === 'lines' ? t.anchor.lines : null,
      messages: await Promise.all(t.messages.map(async (m, i) => {
        const round = review.rounds.find((r) => r.n === m.round);
        return { ...view.messages[i], ref: review.kind === 'uncommitted' ? 'working tree' : round.headSha.slice(0, 7), excerpts: await citationsForMessage(env, m) };
      })),
    });
  }
  return { ok: true, review: id, project: review.project, worktree: review.worktree, threads: out, counts: tally(review.threads) };
}));
