import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { world, HUMAN, agent, editLines } from './_world.js';
import { lines } from './_git.js';
import * as reviews from '../src/reviews.js';
import * as threads from '../src/threads.js';
import * as store from '../src/store.js';
import { MAX_BODY_CHARS } from '../src/threads.js';

let w;
beforeEach(async () => { w = await world(); });
afterEach(() => w.cleanup());

const ok = (res) => { assert.equal(res.ok, true, JSON.stringify(res)); return res; };
const codeOf = (res) => { assert.equal(res.ok, false, 'expected a refusal'); return res.code; };
const open = async (args = {}, actor = HUMAN) => ok(await reviews.openReview({ project: 'app', worktree: 'feature', ...args }, actor)).review;
const at = (file, startLine, endLine = startLine, side = 'new') => ({ kind: 'lines', file, side, startLine, endLine });
const say = (id, anchor, extra = {}, actor = HUMAN) =>
  threads.annotate(id, actor, { anchor, kind: 'comment', body: 'b', ...extra });

async function rangeReview(files = { 'a.js': editLines({ 2: 'X' }) }, args = {}, actor = HUMAN) {
  const wt = w.addWorktree();
  wt.commit(files);
  return { wt, review: await open(args, actor) };
}

test('annotate: a finding needs a severity, other kinds ignore it', async () => {
  const { review } = await rangeReview();
  assert.equal(codeOf(await say(review.id, at('a.js', 2), { kind: 'finding' })), 'SEVERITY_REQUIRED');
  assert.equal(codeOf(await say(review.id, at('a.js', 2), { kind: 'finding', severity: 'huge' })), 'SEVERITY_REQUIRED');
  assert.equal(ok(await say(review.id, at('a.js', 2), { kind: 'finding', severity: 'major' })).thread.severity, 'major');
  assert.equal(ok(await say(review.id, at('a.js', 2), { kind: 'question', severity: 'major' })).thread.severity, null);
  assert.equal(codeOf(await say(review.id, at('a.js', 2), { kind: 'rant' })), 'INVALID_ARGUMENT');
  assert.equal(codeOf(await say(review.id, at('a.js', 2), { body: '  ' })), 'INVALID_ARGUMENT');
});

test('annotate: lines outside the file, a reversed range, an absent file and an absent side are refused', async () => {
  const { review } = await rangeReview();
  assert.equal(codeOf(await say(review.id, at('a.js', 21))), 'LINE_OUT_OF_RANGE');
  assert.equal(codeOf(await say(review.id, at('a.js', 5, 4))), 'INVALID_ARGUMENT');
  assert.equal(codeOf(await say(review.id, at('a.js', 0))), 'INVALID_ARGUMENT');
  assert.equal(codeOf(await say(review.id, at('b.js', 1))), 'FILE_NOT_IN_DIFF');
  ok(await say(review.id, at('a.js', 20)));
});

test('annotate: context outside any hunk is allowed and carries no hunk id', async () => {
  const { review } = await rangeReview();
  const t = ok(await say(review.id, at('a.js', 15, 16))).thread;
  assert.equal(t.anchor.hunkId, null);
  assert.equal(ok(await say(review.id, at('a.js', 2))).thread.anchor.hunkId !== null, true);
});

test('annotate: a binary file takes no line anchors', async () => {
  const { review } = await rangeReview({ 'img.bin': Buffer.from([0, 1, 2, 0, 255]) });
  const diff = ok(await reviews.diff(review.id, {}));
  assert.equal(diff.files[0].binary, true);
  assert.equal(codeOf(await say(review.id, at('img.bin', 1))), 'BINARY_FILE');
  assert.equal(codeOf(await threads.annotate(review.id, HUMAN, { anchor: { kind: 'hunk', hunkId: diff.files[0].hunks[0].id }, kind: 'comment', body: 'x' })), 'BINARY_FILE');
});

test('annotate: a hunk-only anchor spans the hunk\'s new lines, or its old lines for a pure deletion', async () => {
  const { review } = await rangeReview();
  const hunk = ok(await reviews.diff(review.id, {})).files[0].hunks[0];
  const t = ok(await threads.annotate(review.id, HUMAN, { anchor: { kind: 'hunk', hunkId: hunk.id }, kind: 'comment', body: 'x' })).thread;
  assert.deepEqual([t.anchor.kind, t.anchor.side, t.anchor.startLine, t.anchor.endLine, t.anchor.hunkId], ['lines', 'new', hunk.newStart, hunk.newStart + hunk.newLines - 1, hunk.id]);
  assert.equal(codeOf(await threads.annotate(review.id, HUMAN, { anchor: { kind: 'hunk', hunkId: 'nope' }, kind: 'comment', body: 'x' })), 'HUNK_UNKNOWN');

  const del = w.addWorktree('del');
  del.commit({ 'b.js': null });
  const delReview = await open({ worktree: 'del' });
  const dh = ok(await reviews.diff(delReview.id, {})).files[0].hunks[0];
  assert.equal(dh.newLines, 0);
  const d = ok(await threads.annotate(delReview.id, HUMAN, { anchor: { kind: 'hunk', hunkId: dh.id }, kind: 'comment', body: 'x' })).thread;
  assert.deepEqual([d.anchor.side, d.anchor.startLine, d.anchor.endLine], ['old', 1, 10]);
});

const roster = () => {
  w.session('s-author', { worktree: 'feature' });
  w.session('s-rev', { worktree: 'feature' });
};
const author = agent('s-author');
const reviewer = agent('s-rev');
const conductor = agent('s-cond', '.conduct');

test('roles are derived per review and frozen on messages: recipient=author, conductor project=conductor, others reviewer', async () => {
  roster();
  const { review } = await rangeReview(undefined, { recipient: 's-author' });
  const t = ok(await say(review.id, at('a.js', 2), {}, reviewer)).thread;
  ok(await threads.reply(review.id, author, t.id, { body: 'a' }));
  ok(await threads.reply(review.id, conductor, t.id, { body: 'c' }));
  const msgs = ok(await threads.reply(review.id, HUMAN, t.id, { body: 'h' })).thread.messages;
  assert.deepEqual(msgs.map((m) => m.author), [
    { kind: 'session', sessionId: 's-rev', role: 'reviewer' },
    { kind: 'session', sessionId: 's-author', role: 'author' },
    { kind: 'session', sessionId: 's-cond', role: 'conductor' },
    { kind: 'human' },
  ]);
});

test('a stored author is author, the conductor recipient is conductor, others are reviewer', async () => {
  roster();
  const { review } = await rangeReview(undefined, { author: 's-author' }, conductor);
  const t = ok(await say(review.id, at('a.js', 2), {}, reviewer)).thread;
  ok(await threads.reply(review.id, author, t.id, { body: 'a' }));
  const msgs = ok(await threads.reply(review.id, conductor, t.id, { body: 'c' })).thread.messages;
  assert.deepEqual(msgs.map((m) => m.author.role), ['reviewer', 'author', 'conductor']);
});

test('on an uncommitted review every non-conductor agent is a reviewer, even the recipient', async () => {
  roster();
  const wt = w.addWorktree();
  wt.write('a.js', editLines({ 2: 'X' }));
  const review = await open({ kind: 'uncommitted', recipient: 's-author' });
  const t = ok(await say(review.id, at('a.js', 2), {}, author)).thread;
  assert.equal(t.openedBy.role, 'reviewer');
});

test('resolve: the opener closes its own comment, question and suggestion; another agent only proposes', async () => {
  roster();
  const { review } = await rangeReview(undefined, { recipient: 's-author' });
  const blockers = async () => ok(await reviews.getReview(review.id)).review.mergeBlockers;
  for (const [i, kind] of ['comment', 'question', 'suggestion'].entries()) {
    const mine = ok(await say(review.id, at('a.js', 2 + i), { kind }, reviewer)).thread;
    if (kind === 'question') assert.equal(await blockers(), 1);
    const done = ok(await threads.reply(review.id, reviewer, mine.id, { body: 'ok', resolve: true })).thread;
    assert.deepEqual([done.status, done.resolveProposed], ['resolved', false]);
    const stored = (await store.read(review.id)).threads.find((x) => x.id === mine.id);
    assert.equal(stored.disposition, null);
    assert.deepEqual(stored.resolution.by, { kind: 'session', sessionId: 's-rev', role: 'reviewer' });
    if (kind === 'question') assert.equal(await blockers(), 0);
  }
  const theirs = ok(await say(review.id, at('a.js', 6), {}, reviewer)).thread;
  const proposed = ok(await threads.reply(review.id, author, theirs.id, { body: 'fixed', resolve: true })).thread;
  assert.equal(proposed.status, 'open');
  assert.equal(proposed.resolveProposed, true);
  assert.equal(proposed.messages[1].proposeResolve, true);
  assert.equal(ok(await threads.reply(review.id, author, theirs.id, { body: 'more' })).thread.status, 'open', 'a plain reply never changes status');
  const cond = ok(await say(review.id, at('a.js', 7), {}, conductor)).thread;
  const onCond = ok(await threads.reply(review.id, reviewer, cond.id, { body: 'done', resolve: true })).thread;
  assert.deepEqual([onCond.status, onCond.resolveProposed], ['open', true]);
});

test('resolve: a conductor reply without resolve never closes, and a close clears an earlier proposal', async () => {
  roster();
  const { review } = await rangeReview(undefined, { recipient: 's-author' });
  const t = ok(await say(review.id, at('a.js', 2), {}, reviewer)).thread;
  const plain = ok(await threads.reply(review.id, conductor, t.id, { body: 'hm' })).thread;
  assert.deepEqual([plain.status, plain.resolveProposed], ['open', false]);
  assert.equal(ok(await threads.reply(review.id, author, t.id, { body: 'fixed', resolve: true })).thread.resolveProposed, true);
  const closed = ok(await threads.reply(review.id, conductor, t.id, { body: 'ok', resolve: true })).thread;
  assert.deepEqual([closed.status, closed.resolveProposed], ['resolved', false]);
});

test('resolve: on an already resolved user-opened thread the conductor\'s resolve only proposes, so resolveProposed is the signal', async () => {
  roster();
  const { review } = await rangeReview(undefined, { recipient: 's-author' });
  const t = ok(await say(review.id, at('a.js', 2))).thread;
  ok(await threads.setThreadStatus(review.id, t.id, { status: 'resolved' }));
  const res = ok(await threads.reply(review.id, conductor, t.id, { body: 'ok', resolve: true })).thread;
  assert.equal(res.resolveProposed, true);
});

test('resolve: an agent never overrides a human\'s close of an agent thread, nor re-resolves its own resolved one', async () => {
  roster();
  const { review } = await rangeReview(undefined, { recipient: 's-author' });
  const f = ok(await say(review.id, at('a.js', 2), { kind: 'finding', severity: 'major' }, reviewer)).thread;
  ok(await threads.setThreadStatus(review.id, f.id, { status: 'resolved', disposition: 'fixed' }));
  const before = (await store.read(review.id)).threads.find((x) => x.id === f.id).resolution;
  const res = ok(await threads.reply(review.id, conductor, f.id, { body: 'no', resolve: true, disposition: 'dismissed' })).thread;
  assert.deepEqual([res.disposition, res.resolveProposed], ['fixed', true]);
  assert.deepEqual((await store.read(review.id)).threads.find((x) => x.id === f.id).resolution, before);
  const byOpener = ok(await threads.reply(review.id, reviewer, f.id, { body: 'no', resolve: true, disposition: 'dismissed' })).thread;
  assert.deepEqual([byOpener.disposition, byOpener.resolveProposed], ['fixed', true]);
  assert.deepEqual((await store.read(review.id)).threads.find((x) => x.id === f.id).resolution, before);
  const c = ok(await say(review.id, at('a.js', 3), {}, reviewer)).thread;
  ok(await threads.reply(review.id, reviewer, c.id, { body: 'ok', resolve: true }));
  const again = ok(await threads.reply(review.id, reviewer, c.id, { body: 'again', resolve: true })).thread;
  assert.deepEqual([again.status, again.resolveProposed], ['resolved', true]);
});

test('resolve: the conductor closes a thread it opened itself', async () => {
  roster();
  const { review } = await rangeReview(undefined, { recipient: 's-author' });
  const t = ok(await say(review.id, at('a.js', 2), {}, conductor)).thread;
  const done = ok(await threads.reply(review.id, conductor, t.id, { body: 'ok', resolve: true })).thread;
  assert.deepEqual([done.status, done.resolveProposed], ['resolved', false]);
  const stored = (await store.read(review.id)).threads.find((x) => x.id === t.id);
  assert.deepEqual(stored.resolution.by, { kind: 'session', sessionId: 's-cond', role: 'conductor' });
  assert.equal(stored.disposition, null);
});

test('resolve: the conductor closes threads other agents opened, a finding only with a disposition', async () => {
  roster();
  const { review } = await rangeReview(undefined, { recipient: 's-author' });
  const c = ok(await say(review.id, at('a.js', 2), {}, reviewer)).thread;
  const q = ok(await say(review.id, at('a.js', 3), { kind: 'question' }, author)).thread;
  const blockers = async () => ok(await reviews.getReview(review.id)).review.mergeBlockers;
  assert.equal(await blockers(), 1);
  assert.equal(ok(await threads.reply(review.id, conductor, c.id, { body: 'ok', resolve: true })).thread.status, 'resolved');
  assert.equal(ok(await threads.reply(review.id, conductor, q.id, { body: 'ok', resolve: true })).thread.status, 'resolved');
  assert.equal(await blockers(), 0);
  const f = ok(await say(review.id, at('a.js', 4), { kind: 'finding', severity: 'major' }, reviewer)).thread;
  assert.equal(codeOf(await threads.reply(review.id, conductor, f.id, { body: 'done', resolve: true })), 'INVALID_ARGUMENT');
  assert.equal(ok(await reviews.diff(review.id, {})).files[0].threads.find((x) => x.id === f.id).messages.length, 1);
  const closed = ok(await threads.reply(review.id, conductor, f.id, { body: 'done', resolve: true, disposition: 'dismissed' })).thread;
  assert.deepEqual([closed.status, closed.disposition, closed.resolveProposed], ['resolved', 'dismissed', false]);
  const reopened = ok(await threads.setThreadStatus(review.id, f.id, { status: 'open' })).thread;
  assert.deepEqual([reopened.status, reopened.disposition], ['open', null]);
});

test('resolve: the conductor only proposes on a user-opened thread, even a finding with a disposition', async () => {
  roster();
  const { review } = await rangeReview(undefined, { recipient: 's-author' });
  const c = ok(await say(review.id, at('a.js', 2))).thread;
  const onC = ok(await threads.reply(review.id, conductor, c.id, { body: 'ok', resolve: true })).thread;
  assert.deepEqual([onC.status, onC.resolveProposed, onC.messages.at(-1).proposeResolve], ['open', true, true]);
  const f = ok(await say(review.id, at('a.js', 3), { kind: 'finding', severity: 'minor' })).thread;
  const onF = ok(await threads.reply(review.id, conductor, f.id, { body: 'ok', resolve: true, disposition: 'fixed' })).thread;
  assert.deepEqual([onF.status, onF.resolveProposed, onF.disposition], ['open', true, null]);
});

test('resolve: neither the conductor nor the opener closes an outdated agent thread', async () => {
  roster();
  const wt = w.addWorktree();
  wt.commit({ 'a.js': editLines({ 2: 'top-edit', 18: 'bottom-edit' }) });
  const review = await open({ recipient: 's-author' });
  const t = ok(await say(review.id, at('a.js', 10), {}, reviewer)).thread;
  wt.commit({ 'a.js': editLines({ 2: 'top-edit-again', 18: 'bottom-edit', 7: 'q7', 8: 'q8', 9: 'q9', 10: 'q10', 11: 'q11', 12: 'q12', 13: 'q13' }) });
  ok(await reviews.refreshReview(review.id, HUMAN));
  const res = ok(await threads.reply(review.id, conductor, t.id, { body: 'ok', resolve: true })).thread;
  assert.deepEqual([res.status, res.resolveProposed], ['outdated', true]);
  const byOpener = ok(await threads.reply(review.id, reviewer, t.id, { body: 'ok', resolve: true })).thread;
  assert.deepEqual([byOpener.status, byOpener.resolveProposed], ['outdated', true]);
  assert.equal((await store.read(review.id)).threads.find((x) => x.id === t.id).resolution, null);
});

test('disposition is refused unless the conductor or the finding\'s opener resolves it, and nothing is posted', async () => {
  roster();
  const { review } = await rangeReview(undefined, { recipient: 's-author' });
  const f = ok(await say(review.id, at('a.js', 2), { kind: 'finding', severity: 'major' }, reviewer)).thread;
  const c = ok(await say(review.id, at('a.js', 3), {}, reviewer)).thread;
  const hf = ok(await say(review.id, at('a.js', 4), { kind: 'finding', severity: 'minor' })).thread;
  const refused = async (actor, tid, args) => {
    assert.equal(codeOf(await threads.reply(review.id, actor, tid, { body: 'x', ...args })), 'INVALID_ARGUMENT');
  };
  await refused(author, f.id, { resolve: true, disposition: 'fixed' });
  await refused(reviewer, f.id, { disposition: 'fixed' });
  await refused(reviewer, c.id, { resolve: true, disposition: 'fixed' });
  await refused(reviewer, f.id, { resolve: true, disposition: 'maybe' });
  await refused(author, hf.id, { resolve: true, disposition: 'fixed' });
  await refused(conductor, f.id, { disposition: 'fixed' });
  await refused(conductor, c.id, { resolve: true, disposition: 'fixed' });
  await refused(conductor, f.id, { resolve: true, disposition: 'maybe' });
  const stored = (await store.read(review.id)).threads;
  assert.deepEqual(stored.map((x) => x.messages.length), [1, 1, 1]);
});

test('listThreads filters by owner: user, agents, both when absent; it composes with status; another owner is refused', async () => {
  roster();
  const { review } = await rangeReview(undefined, { recipient: 's-author' });
  const h = ok(await say(review.id, at('a.js', 2))).thread;
  const r = ok(await say(review.id, at('a.js', 3), { kind: 'finding', severity: 'minor' }, reviewer)).thread;
  const c = ok(await say(review.id, at('a.js', 4), {}, conductor)).thread;
  const ids = async (args) => ok(await threads.listThreads(review.id, args)).threads.map((t) => t.id);
  assert.deepEqual(await ids({ owner: 'user' }), [h.id]);
  assert.deepEqual(await ids({ owner: 'agents' }), [r.id, c.id]);
  assert.deepEqual(await ids({}), [h.id, r.id, c.id]);
  ok(await threads.reply(review.id, conductor, c.id, { body: 'ok', resolve: true }));
  assert.deepEqual(await ids({ status: 'open', owner: 'agents' }), [r.id]);
  assert.deepEqual(await ids({ status: 'resolved', owner: 'agents' }), [c.id]);
  assert.equal(codeOf(await threads.listThreads(review.id, { owner: 'bots' })), 'INVALID_ARGUMENT');
});

test('resolve: the human closes a finding only with a disposition and can reopen; only findings carry one', async () => {
  roster();
  const { review } = await rangeReview(undefined, { recipient: 's-author' });
  const f = ok(await say(review.id, at('a.js', 2), { kind: 'finding', severity: 'major' }, reviewer)).thread;
  assert.equal(codeOf(await threads.setThreadStatus(review.id, f.id, { status: 'resolved' })), 'INVALID_ARGUMENT');
  const closed = ok(await threads.setThreadStatus(review.id, f.id, { status: 'resolved', disposition: 'dismissed' })).thread;
  assert.deepEqual([closed.status, closed.disposition, closed.resolveProposed], ['resolved', 'dismissed', false]);
  const reopened = ok(await threads.setThreadStatus(review.id, f.id, { status: 'open' })).thread;
  assert.deepEqual([reopened.status, reopened.disposition], ['open', null]);
  const c = ok(await say(review.id, at('a.js', 3))).thread;
  assert.equal(ok(await threads.setThreadStatus(review.id, c.id, { status: 'resolved', disposition: 'fixed' })).thread.disposition, null, 'only findings carry a disposition');
  assert.equal(codeOf(await threads.setThreadStatus(review.id, 'tX', { status: 'open' })), 'THREAD_UNKNOWN');
});

test('resolve: the opener closes its own finding with either disposition; without one it is refused and nothing is posted', async () => {
  roster();
  const { review } = await rangeReview(undefined, { recipient: 's-author' });
  const f1 = ok(await say(review.id, at('a.js', 2), { kind: 'finding', severity: 'major' }, reviewer)).thread;
  const f2 = ok(await say(review.id, at('a.js', 3), { kind: 'finding', severity: 'minor' }, reviewer)).thread;
  assert.equal(codeOf(await threads.reply(review.id, reviewer, f1.id, { body: 'done', resolve: true })), 'INVALID_ARGUMENT');
  const stored = async (tid) => (await store.read(review.id)).threads.find((x) => x.id === tid);
  assert.deepEqual([(await stored(f1.id)).messages.length, (await stored(f1.id)).status], [1, 'open']);
  const c1 = ok(await threads.reply(review.id, reviewer, f1.id, { body: 'done', resolve: true, disposition: 'fixed' })).thread;
  assert.deepEqual([c1.status, c1.disposition, c1.resolveProposed], ['resolved', 'fixed', false]);
  assert.equal((await stored(f1.id)).resolution.by.sessionId, 's-rev');
  const c2 = ok(await threads.reply(review.id, reviewer, f2.id, { body: 'no', resolve: true, disposition: 'dismissed' })).thread;
  assert.deepEqual([c2.status, c2.disposition, c2.resolveProposed], ['resolved', 'dismissed', false]);
  const reopened = ok(await threads.setThreadStatus(review.id, f1.id, { status: 'open' })).thread;
  assert.deepEqual([reopened.status, reopened.disposition], ['open', null]);
});

test('resolve: another agent only proposes on an agent\'s finding, and never closes a user-opened thread', async () => {
  roster();
  const { review } = await rangeReview(undefined, { recipient: 's-author' });
  const f = ok(await say(review.id, at('a.js', 2), { kind: 'finding', severity: 'major' }, reviewer)).thread;
  const res = ok(await threads.reply(review.id, author, f.id, { body: 'fixed', resolve: true })).thread;
  assert.deepEqual([res.status, res.resolveProposed, res.disposition], ['open', true, null]);
  assert.equal(res.messages.at(-1).proposeResolve, true);
  const hc = ok(await say(review.id, at('a.js', 3))).thread;
  const hf = ok(await say(review.id, at('a.js', 4), { kind: 'finding', severity: 'minor' })).thread;
  for (const t of [hc, hf]) {
    const r = ok(await threads.reply(review.id, reviewer, t.id, { body: 'ok', resolve: true })).thread;
    assert.deepEqual([r.status, r.resolveProposed], ['open', true]);
  }
});

async function uncommittedReview(edits = { 10: 'X10' }, actor = HUMAN) {
  const wt = w.addWorktree();
  wt.write('a.js', editLines(edits));
  return { wt, review: await open({ kind: 'uncommitted' }, actor) };
}

test('uncommitted: an edit elsewhere in the same hunk keeps the thread where it was', async () => {
  const { wt, review } = await uncommittedReview();
  const t = ok(await say(review.id, at('a.js', 10))).thread;
  wt.write('a.js', editLines({ 10: 'X10', 12: 'other' }));
  const live = ok(await reviews.diff(review.id, { file: 'a.js' })).files[0].threads;
  assert.deepEqual(live.map((x) => [x.id, x.anchor.startLine]), [[t.id, 10]]);
});

test('uncommitted: lines inserted above move the thread with its lines', async () => {
  const { wt, review } = await uncommittedReview();
  const t = ok(await say(review.id, at('a.js', 10))).thread;
  wt.write('a.js', ['ins1', 'ins2', ...editLines({ 10: 'X10' }).split('\n')].join('\n'));
  const live = ok(await reviews.diff(review.id, { file: 'a.js' })).files[0].threads;
  assert.deepEqual(live.map((x) => [x.id, x.anchor.startLine]), [[t.id, 12]]);
});

test('uncommitted: changed lines drop the thread, and a later reply says THREAD_DROPPED', async () => {
  const { wt, review } = await uncommittedReview();
  const t = ok(await say(review.id, at('a.js', 10))).thread;
  wt.write('a.js', editLines({ 10: 'rewritten' }));
  assert.deepEqual(ok(await reviews.diff(review.id, { file: 'a.js' })).files[0].threads, []);
  assert.equal(codeOf(await threads.reply(review.id, HUMAN, t.id, { body: 'x' })), 'THREAD_DROPPED');
  assert.equal(codeOf(await threads.setThreadStatus(review.id, t.id, { status: 'resolved' })), 'THREAD_DROPPED');
  assert.equal(codeOf(await threads.reply(review.id, HUMAN, 't99', { body: 'x' })), 'THREAD_UNKNOWN');
});

test('uncommitted: a thread whose file leaves the diff is dropped', async () => {
  const { wt, review } = await uncommittedReview();
  ok(await say(review.id, at('a.js', 10)));
  wt.git('checkout', '--', 'a.js');
  assert.equal(ok(await reviews.getReview(review.id)).review.counts.threads.open, 0);
});

test('uncommitted: with the checkout gone the review stays readable from the store, threads intact', async () => {
  const { wt, review } = await uncommittedReview();
  ok(await say(review.id, at('a.js', 10)));
  wt.destroy();
  const detail = ok(await reviews.getReview(review.id));
  assert.equal(detail.review.checkoutGone, true);
  assert.equal(detail.review.snapshotError, 'CHECKOUT_GONE');
  assert.equal(detail.review.counts.threads.open, 1);
  assert.equal(codeOf(await reviews.diff(review.id, {})), 'CHECKOUT_GONE');
});

test('unread: agent messages count for the human, human ones do not, markRead clears', async () => {
  roster();
  const { review } = await rangeReview(undefined, { recipient: 's-author' });
  const t = ok(await say(review.id, at('a.js', 2))).thread;
  assert.equal(ok(await reviews.getReview(review.id)).review.unread, 0);
  ok(await threads.reply(review.id, author, t.id, { body: 'a' }));
  ok(await threads.reply(review.id, reviewer, t.id, { body: 'b' }));
  const detail = ok(await reviews.getReview(review.id));
  assert.equal(detail.review.unread, 2);
  assert.equal(detail.files[0].unread, 2);
  assert.equal(ok(await threads.markRead(review.id, { threadId: t.id })).review.unread, 0);
  ok(await threads.reply(review.id, author, t.id, { body: 'c' }));
  assert.equal(ok(await reviews.getReview(review.id)).review.unread, 1);
  ok(await threads.reply(review.id, HUMAN, t.id, { body: 'my answer' }));
  assert.equal(ok(await reviews.getReview(review.id)).review.unread, 0, 'the human replying has read everything before it');
  assert.equal(codeOf(await threads.markRead(review.id, { threadId: 'tX' })), 'THREAD_UNKNOWN');
});

test('a review opened by an agent is unseen until the human marks it read', async () => {
  roster();
  const { review } = await rangeReview(undefined, {}, reviewer);
  assert.equal(review.seenByHuman, false);
  assert.equal(ok(await threads.markRead(review.id)).review.seenByHuman, true);
});

test('open question threads count as merge blockers until resolved', async () => {
  const { review } = await rangeReview();
  const q = ok(await say(review.id, at('a.js', 2), { kind: 'question' })).thread;
  assert.equal(ok(await reviews.getReview(review.id)).review.mergeBlockers, 1);
  ok(await threads.setThreadStatus(review.id, q.id, { status: 'resolved' }));
  assert.equal(ok(await reviews.getReview(review.id)).review.mergeBlockers, 0);
});

test('mergeBlockers counts open questions only, not other open threads', async () => {
  const { review } = await rangeReview();
  ok(await say(review.id, at('a.js', 2), { kind: 'comment' }));
  ok(await say(review.id, at('a.js', 3), { kind: 'suggestion' }));
  ok(await say(review.id, at('a.js', 4), { kind: 'finding', severity: 'blocker' }));
  assert.equal(ok(await reviews.getReview(review.id)).review.mergeBlockers, 0);
  ok(await say(review.id, at('a.js', 5), { kind: 'question' }));
  assert.equal(ok(await reviews.getReview(review.id)).review.mergeBlockers, 1);
});

test('a message body over the cap is refused BODY_TOO_LARGE, when opening a thread and when replying', async () => {
  const { review } = await rangeReview();
  const huge = 'x'.repeat(MAX_BODY_CHARS + 1);
  assert.equal(codeOf(await say(review.id, at('a.js', 2), { body: huge })), 'BODY_TOO_LARGE');
  const t = ok(await say(review.id, at('a.js', 2), { body: 'x'.repeat(MAX_BODY_CHARS) })).thread;
  assert.equal(codeOf(await threads.reply(review.id, HUMAN, t.id, { body: huge })), 'BODY_TOO_LARGE');
});

test('annotate refuses a tooLarge file with BINARY_FILE, for a line anchor and for a hunk anchor', async () => {
  const wt = w.addWorktree();
  wt.write('big.txt', 'x\n'.repeat(600000));
  const review = await open({ kind: 'uncommitted' });
  const big = ok(await reviews.diff(review.id, {})).files.find((f) => f.path === 'big.txt');
  assert.equal(big.tooLarge, true);
  assert.equal(codeOf(await say(review.id, at('big.txt', 1))), 'BINARY_FILE');
  assert.equal(codeOf(await threads.annotate(review.id, HUMAN, { anchor: { kind: 'hunk', hunkId: big.hunks[0].id }, kind: 'comment', body: 'x' })), 'BINARY_FILE');
  assert.equal(ok(await say(review.id, { kind: 'file', file: 'big.txt' })).thread.anchor.file, 'big.txt', 'a file anchor reads no lines');
});

// ---- file and review anchors ----

const onFile = (file) => ({ kind: 'file', file });
const onReview = { kind: 'review' };

test('annotate: a file anchor is {kind, file, round}, sits in its file\'s diff threads and FileState, and returns that file\'s sig', async () => {
  // Invariant: a file anchor stores and shows only kind/file/round; withThreads and fileStates pick it up by anchor.file; fileSig is the file's live sig.
  const { review } = await rangeReview();
  const res = ok(await say(review.id, onFile('a.js')));
  assert.deepEqual(res.thread.anchor, { kind: 'file', file: 'a.js', round: 1 });
  assert.deepEqual(store.read(review.id).threads[0].anchor, { kind: 'file', file: 'a.js', round: 1 });
  const file = ok(await reviews.diff(review.id, { file: 'a.js' })).files[0];
  assert.deepEqual(file.threads.map((t) => t.id), [res.thread.id]);
  assert.deepEqual(res.fileSig, { path: 'a.js', sig: file.sig });
  assert.equal(ok(await reviews.getReview(review.id)).files[0].threads.open, 1);
});

test('annotate: a file anchor takes a binary file, where a lines anchor is refused BINARY_FILE', async () => {
  // Invariant: the binary refusal applies to line anchors only; a file anchor never reads lines.
  const { review } = await rangeReview({ 'img.bin': Buffer.from([0, 1, 2, 0, 255]) });
  assert.equal(codeOf(await say(review.id, at('img.bin', 1))), 'BINARY_FILE');
  assert.deepEqual(ok(await say(review.id, onFile('img.bin'))).thread.anchor, { kind: 'file', file: 'img.bin', round: 1 });
});

test('annotate: a file anchor on a path outside the diff is refused FILE_NOT_IN_DIFF', async () => {
  // Invariant: a file anchor needs its file in the current snapshot.
  const { review } = await rangeReview();
  assert.equal(codeOf(await say(review.id, onFile('b.js'))), 'FILE_NOT_IN_DIFF');
  assert.equal(codeOf(await say(review.id, onFile('nope.js'))), 'FILE_NOT_IN_DIFF');
});

test('annotate: a review anchor is {kind, round} with a null fileSig, listed in reviewThreads and the summary but on no file', async () => {
  // Invariant: review threads count in counts.threads and unread, appear in getReview().reviewThreads, and in no DiffFile or FileState.
  roster();
  const { review } = await rangeReview(undefined, { recipient: 's-author' });
  const res = ok(await say(review.id, onReview, {}, reviewer));
  assert.deepEqual(res.thread.anchor, { kind: 'review', round: 1 });
  assert.equal(res.fileSig, null);
  const detail = ok(await reviews.getReview(review.id));
  assert.deepEqual(detail.reviewThreads.map((t) => t.id), [res.thread.id]);
  assert.deepEqual([detail.review.counts.threads.open, detail.review.unread], [1, 1]);
  assert.deepEqual(detail.files.map((f) => [f.threads.open, f.unread]), [[0, 0]]);
  assert.deepEqual(ok(await reviews.diff(review.id, {})).files.flatMap((f) => f.threads), []);
});

test('annotate: a review anchor reads no snapshot, so it is written while the diff is unreadable', async () => {
  // Invariant: annotate reads the snapshot for lines, hunk and file anchors only.
  const { wt, review } = await uncommittedReview();
  wt.destroy();
  assert.equal(codeOf(await say(review.id, at('a.js', 10))), 'CHECKOUT_GONE');
  assert.equal(codeOf(await say(review.id, onFile('a.js'))), 'CHECKOUT_GONE');
  assert.equal(ok(await say(review.id, onReview)).thread.anchor.kind, 'review');
});

test('annotate: an anchor spec with an unknown kind, a key its kind does not take or a missing required key is refused and writes nothing', async () => {
  // Invariant: buildAnchor's checks refuse every bad combination with INVALID_ARGUMENT before any write, in words that name no spec key.
  const { review } = await rangeReview();
  const hunkId = ok(await reviews.diff(review.id, {})).files[0].hunks[0].id;
  const before = store.read(review.id);
  const bad = [
    undefined, 'a.js',
    { file: 'a.js', startLine: 2 }, { kind: 'range', file: 'a.js' }, { kind: 'toString' },
    { kind: 'lines', startLine: 2 }, { kind: 'lines', file: 'a.js' }, { kind: 'lines', file: 'a.js', startLine: 2, hunkId },
    { kind: 'file', file: 'a.js', startLine: 2 }, { kind: 'file', file: 'a.js', endLine: 2 }, { kind: 'file', file: 'a.js', side: 'new' },
    { kind: 'file', file: 'a.js', hunkId }, { kind: 'file' },
    { kind: 'review', file: 'a.js' }, { kind: 'review', startLine: 2 }, { kind: 'review', side: 'new' }, { kind: 'review', hunkId },
    { kind: 'hunk', hunkId, file: 'a.js' }, { kind: 'hunk', hunkId, startLine: 2 }, { kind: 'hunk' },
    // keys no kind takes, given values (REST passes the anchor object through)
    { kind: 'review', round: 2 }, { kind: 'file', file: 'a.js', linesHash: 'x' }, { kind: 'lines', file: 'a.js', startLine: 2, drifted: false },
    { kind: 'hunk', hunkId, extra: null },
  ];
  for (const anchor of bad) {
    const res = await say(review.id, anchor);
    assert.equal(codeOf(res), 'INVALID_ARGUMENT', JSON.stringify(anchor));
    assert.doesNotMatch(res.reason, /hunkId|startLine|endLine/, res.reason);
  }
  const after = store.read(review.id);
  assert.deepEqual([after.seq, after.threads], [before.seq, before.threads]);
});

test('annotate: a refused anchor that lacks what its kind needs names only what is missing, in domain words', async () => {
  // Invariant: checkSpec's needs refusal lists exactly the missing fields (file, start line, hunk), never one that was given.
  const { review } = await rangeReview();
  const reason = async (anchor) => {
    const res = await say(review.id, anchor);
    assert.equal(codeOf(res), 'INVALID_ARGUMENT');
    return res.reason;
  };
  const noStart = await reason({ kind: 'lines', file: 'a.js' });
  assert.match(noStart, /start line/);
  assert.doesNotMatch(noStart, /\bfile\b/);
  const noFile = await reason({ kind: 'lines', startLine: 2 });
  assert.match(noFile, /\bfile\b/);
  assert.doesNotMatch(noFile, /start line/);
  const neither = await reason({ kind: 'lines' });
  assert.match(neither, /\bfile\b.*start line|start line.*\bfile\b/);
  assert.match(await reason({ kind: 'file' }), /\bfile\b/);
  assert.match(await reason({ kind: 'hunk' }), /\bhunk\b/);
});

test('mergeBlockers counts an open question alike on every anchor kind, on range and uncommitted reviews; findings and comments never', async () => {
  // Invariant: mergeBlockers ignores the anchor: +1 per open question whatever it sits on, 0 for findings (even blockers) and comments.
  const { review: range } = await rangeReview();
  const unc = w.addWorktree('unc');
  unc.write('a.js', editLines({ 10: 'X10' }));
  const uncommitted = await open({ kind: 'uncommitted', worktree: 'unc' });
  for (const [review, line] of [[range, 2], [uncommitted, 10]]) {
    const blockers = async () => ok(await reviews.getReview(review.id)).review.mergeBlockers;
    for (const anchor of [at('a.js', line), onFile('a.js'), onReview]) {
      const q = ok(await say(review.id, anchor, { kind: 'question' })).thread;
      assert.equal(await blockers(), 1, `${review.kind} ${anchor.kind}`);
      ok(await say(review.id, anchor, { kind: 'finding', severity: 'blocker' }));
      ok(await say(review.id, anchor, { kind: 'comment' }));
      assert.equal(await blockers(), 1, `${review.kind} ${anchor.kind}`);
      ok(await threads.setThreadStatus(review.id, q.id, { status: 'resolved' }));
      assert.equal(await blockers(), 0, `${review.kind} ${anchor.kind}`);
    }
  }
});

test('file and review threads take the whole resolve flow; their writes return the file\'s sig, or null for the review', async () => {
  // Invariant: resolve rights and dispositions ignore the anchor kind; reply/setThreadStatus fileSig is {path, sig} on a file thread, null on a review thread.
  roster();
  const { review } = await rangeReview(undefined, { recipient: 's-author' });
  for (const anchor of [onFile('a.js'), onReview]) {
    const sigOk = (res) => {
      if (anchor.kind === 'review') assert.equal(res.fileSig, null);
      else assert.deepEqual([res.fileSig.path, typeof res.fileSig.sig], ['a.js', 'string']);
      return res;
    };
    const c = ok(await say(review.id, anchor)).thread;
    assert.equal(sigOk(ok(await threads.setThreadStatus(review.id, c.id, { status: 'resolved' }))).thread.status, 'resolved');
    assert.equal(ok(await threads.setThreadStatus(review.id, c.id, { status: 'open' })).thread.status, 'open');
    const f = ok(await say(review.id, anchor, { kind: 'finding', severity: 'major' })).thread;
    assert.equal(codeOf(await threads.setThreadStatus(review.id, f.id, { status: 'resolved' })), 'INVALID_ARGUMENT');
    assert.equal(ok(await threads.setThreadStatus(review.id, f.id, { status: 'resolved', disposition: 'fixed' })).thread.disposition, 'fixed');
    const mine = ok(await say(review.id, anchor, {}, reviewer)).thread;
    assert.equal(sigOk(ok(await threads.reply(review.id, reviewer, mine.id, { body: 'ok', resolve: true }))).thread.status, 'resolved');
    const theirs = ok(await say(review.id, anchor, { kind: 'question' }, author)).thread;
    assert.equal(ok(await threads.reply(review.id, reviewer, theirs.id, { body: 'done', resolve: true })).thread.status, 'open', 'another agent only proposes');
    assert.equal(ok(await threads.reply(review.id, conductor, theirs.id, { body: 'ok', resolve: true })).thread.status, 'resolved');
  }
});

test('a file thread\'s reply returns the sig the file\'s diff then serves', async () => {
  // Invariant: sigAfterWrite signs the file of a file anchor, so the UI patches instead of refetching.
  const { review } = await rangeReview();
  const t = ok(await say(review.id, onFile('a.js'))).thread;
  const res = ok(await threads.reply(review.id, HUMAN, t.id, { body: 'more' }));
  assert.equal(res.fileSig.sig, ok(await reviews.diff(review.id, { file: 'a.js' })).files[0].sig);
});
