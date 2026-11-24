import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { world, HUMAN, agent, editLines } from './_world.js';
import * as reviews from '../src/reviews.js';
import * as threads from '../src/threads.js';
import * as groups from '../src/groups.js';
import * as submissions from '../src/submissions.js';
import * as compare from '../src/compare.js';
import { PREVIEW_CHARS, ACTIVITY_LIMIT } from '../src/overview.js';
import { views } from '../src/mcpViews.js';

let w;
beforeEach(async () => { w = await world(); w.session('s-author', { worktree: 'feature' }); });
afterEach(() => w.cleanup());

const ok = (res) => { assert.equal(res.ok, true, JSON.stringify(res)); return res; };
const at = (file, startLine) => ({ kind: 'lines', file, side: 'new', startLine, endLine: startLine });
const author = agent('s-author');

async function open() {
  const wt = w.addWorktree();
  wt.commit({ 'a.js': editLines({ 2: 'top-edit', 18: 'bottom-edit' }) });
  const { review } = ok(await reviews.openReview({ project: 'app', worktree: 'feature', recipient: 's-author' }, HUMAN));
  return { wt, id: review.id };
}
const detail = async (id) => ok(await reviews.getReview(id));
const deliver = async (id) => {
  const { submission } = ok(await submissions.composeSubmission(id));
  ok(await submissions.recordResult(id, submission.id, { ok: true }));
  return submission;
};
const stateOf = (list, tid) => list.find((t) => t.id === tid)?.state;

test('thread states partition the open threads through a random walk of writes, any anchor', async () => {
  // Invariant: counts.threadStates sums to counts.threads.open after any sequence of annotate, reply, resolve, reopen and deliver.
  const { id } = await open();
  let seed = 7;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const anchors = [at('a.js', 2), at('a.js', 18), { kind: 'file', file: 'a.js' }, { kind: 'review' }];
  const open_ = [];
  for (let i = 0; i < 40; i++) {
    const step = rnd(6);
    const tid = open_.length ? open_[rnd(open_.length)] : null;
    if (step === 0 || !tid) {
      const t = ok(await threads.annotate(id, rnd(2) ? HUMAN : author, { anchor: anchors[rnd(anchors.length)], kind: 'comment', body: `n${i}` })).thread;
      open_.push(t.id);
    } else if (step === 1) ok(await threads.reply(id, HUMAN, tid, { body: 'h' }));
    else if (step === 2) ok(await threads.reply(id, author, tid, { body: 'a', resolve: rnd(2) === 1 }));
    else if (step === 3) ok(await threads.setThreadStatus(id, tid, { status: 'resolved' }));
    else if (step === 4) ok(await threads.setThreadStatus(id, tid, { status: 'open' }));
    else await deliver(id).catch(() => {});
    const { counts } = (await detail(id)).review;
    const sum = Object.values(counts.threadStates).reduce((a, b) => a + b, 0);
    assert.equal(sum, counts.threads.open, `step ${i}`);
  }
});

test('every unsent thread is in the next prompt, and a delivery makes it awaiting-agent', async () => {
  // Invariant: "Will be sent" and the prompt share the delivered-round cutoff, so every unsent thread is listed. The converse does
  // not hold: a human reply the agent then answers is listed but awaiting-human.
  const { id } = await open();
  const first = ok(await threads.annotate(id, HUMAN, { anchor: at('a.js', 2), kind: 'question', body: 'first' })).thread;
  await deliver(id);
  assert.equal(stateOf((await detail(id)).openThreads, first.id), 'awaiting-agent');
  const second = ok(await threads.annotate(id, HUMAN, { anchor: { kind: 'review' }, kind: 'comment', body: 'second' })).thread;
  ok(await threads.reply(id, HUMAN, first.id, { body: 'again' }));
  const unsent = (await detail(id)).openThreads.filter((t) => t.state === 'unsent').map((t) => t.id).sort();
  assert.deepEqual(unsent, [first.id, second.id].sort());
  const { submission } = ok(await submissions.composeSubmission(id));
  for (const t of unsent) assert.match(submission.text, new RegExp(`\\[${t}\\]`));
  // A human reply the agent answers is still in the prompt, but it is the human's move.
  ok(await threads.reply(id, author, first.id, { body: 'answer' }));
  assert.equal(stateOf((await detail(id)).openThreads, first.id), 'awaiting-human');
  assert.match(submission.text, new RegExp(`\\[${first.id}\\]`));
  assert.equal(stateOf((await detail(id)).openThreads, second.id), 'unsent', 'pending is not sent');
  ok(await submissions.recordResult(id, submission.id, { ok: true }));
  assert.deepEqual((await detail(id)).openThreads.map((t) => [t.id, t.state]), [[first.id, 'awaiting-human'], [second.id, 'awaiting-agent']]);
});

test('a thread has the same state in the diff, review threads, write results and list_threads', async () => {
  // Invariant: every live surface renders Thread.state through the one threadView.
  const { id } = await open();
  const t = ok(await threads.annotate(id, author, { anchor: { kind: 'review' }, kind: 'comment', body: 'agent says' })).thread;
  const fileT = ok(await threads.annotate(id, HUMAN, { anchor: at('a.js', 2), kind: 'comment', body: 'mine' })).thread;
  assert.equal(t.state, 'awaiting-human');
  assert.equal(fileT.state, 'unsent');
  const d = await detail(id);
  assert.equal(stateOf(d.reviewThreads, t.id), 'awaiting-human');
  assert.equal(stateOf(d.openThreads, t.id), 'awaiting-human');
  assert.equal(stateOf(ok(await reviews.diff(id, {})).files[0].threads, fileT.id), 'unsent');
  const listed = ok(await threads.listThreads(id, {}));
  assert.deepEqual(views.list_threads.json(listed).threads.map((x) => x.state).sort(), ['awaiting-human', 'unsent']);
  assert.equal(ok(await threads.setThreadStatus(id, fileT.id, { status: 'resolved' })).thread.state, null);
});

test('past-round views and comparisons carry no thread state', async () => {
  // Invariant: roundThreadView zeroes state like unread and resolveProposed: a round view is read-only.
  const { wt, id } = await open();
  ok(await threads.annotate(id, author, { anchor: at('a.js', 2), kind: 'comment', body: 'x' }));
  wt.commit({ 'a.js': editLines({ 2: 'top-edit', 18: 'bottom-edit', 5: 'more' }) });
  ok(await reviews.refreshReview(id, HUMAN));
  const past = ok(await reviews.diff(id, { round: 1 }));
  const cmp = ok(await compare.compareRounds(id, { from: 1, to: 2 }));
  const states = [...past.files.flatMap((f) => f.threads), ...cmp.files.flatMap((f) => f.threads)].map((t) => t.state);
  assert.ok(states.length > 0);
  assert.ok(states.every((s) => s === null));
});

test('openThreads lists exactly the open threads of any anchor in thread order, with first-line previews', async () => {
  // Invariant: ThreadDigest.preview is the first non-blank line clipped to PREVIEW_CHARS; resolved threads are absent.
  const { id } = await open();
  const long = 'x'.repeat(PREVIEW_CHARS * 2);
  ok(await threads.annotate(id, HUMAN, { anchor: at('a.js', 2), kind: 'comment', body: `\n\n${long}\nsecond line` }));
  ok(await threads.annotate(id, author, { anchor: { kind: 'review' }, kind: 'comment', body: 'review level' }));
  const gone = ok(await threads.annotate(id, HUMAN, { anchor: { kind: 'file', file: 'a.js' }, kind: 'comment', body: 'closed' })).thread;
  ok(await threads.setThreadStatus(id, gone.id, { status: 'resolved' }));
  const { openThreads } = await detail(id);
  assert.deepEqual(openThreads.map((t) => t.id), ['t1', 't2']);
  assert.ok(openThreads[0].first.preview.length <= PREVIEW_CHARS);
  assert.ok(openThreads[0].first.preview.startsWith('xxx'));
  assert.equal(openThreads[1].last.preview, 'review level');
  assert.equal(openThreads[1].messages, 1);
});

test('activity lists only agent events, newest first with strictly decreasing seq, classified, and is capped', async () => {
  // Invariant: opened = first message, resolved = the agent's resolving message, proposed-resolution = a proposal, else replied.
  const { id } = await open();
  const t1 = ok(await threads.annotate(id, author, { anchor: at('a.js', 2), kind: 'comment', body: 'opens' })).thread;
  ok(await threads.reply(id, HUMAN, t1.id, { body: 'human words' }));
  ok(await threads.reply(id, author, t1.id, { body: 'replies' }));
  ok(await threads.reply(id, author, t1.id, { body: 'proposes', resolve: true })); // the conductor/opener may close: see below
  const { activity } = await detail(id);
  assert.ok(activity.every((a) => a.actor.kind !== 'human'));
  const seqs = activity.map((a) => a.seq);
  assert.deepEqual(seqs, [...seqs].sort((a, b) => b - a));
  assert.equal(new Set(seqs).size, seqs.length);
  assert.deepEqual(activity.map((a) => a.event), ['resolved', 'replied', 'opened']);
  const t2 = ok(await threads.annotate(id, HUMAN, { anchor: { kind: 'review' }, kind: 'comment', body: 'q' })).thread;
  ok(await threads.reply(id, author, t2.id, { body: 'fixed?', resolve: true }));
  assert.equal((await detail(id)).activity[0].event, 'proposed-resolution');
  for (let i = 0; i < ACTIVITY_LIMIT + 3; i++) ok(await threads.reply(id, author, t2.id, { body: `r${i}` }));
  assert.equal((await detail(id)).activity.length, ACTIVITY_LIMIT);
});

test('MCP json carries thread state and threadStates, never the UI-only change markers', async () => {
  // Invariant: seq and lastViewedSeq are stripped from MCP review json, as sig is; state and threadStates stay.
  const { id } = await open();
  ok(await threads.annotate(id, HUMAN, { anchor: { kind: 'review' }, kind: 'comment', body: 'x' }));
  const json = views.get_review.json(await detail(id));
  assert.equal('seq' in json.review, false);
  assert.equal('lastViewedSeq' in json.review, false);
  assert.equal(json.review.counts.threadStates.unsent, 1);
  assert.equal('openThreads' in json, false);
  assert.equal('activity' in json, false);
});

test('an open group thread is in openThreads and counts.threadStates, which still sum to the open threads', async () => {
  // Invariant: counts and the digest list cover every anchor kind, a group thread included.
  const { id } = await open();
  const hunk = ok(await reviews.diff(id, {})).files[0].hunks[0].id;
  ok(await groups.proposeGroups(id, author, [{ title: 'One', description: 'd', hunks: [hunk] }]));
  const g = ok(await threads.annotate(id, author, { anchor: { kind: 'group', groupId: 'g1' }, kind: 'question', body: 'why?' })).thread;
  ok(await threads.annotate(id, HUMAN, { anchor: { kind: 'review' }, kind: 'comment', body: 'mine' }));
  const d = await detail(id);
  assert.deepEqual(d.openThreads.map((t) => [t.id, t.anchor.kind]), [[g.id, 'group'], ['t2', 'review']]);
  assert.deepEqual(d.review.counts.threadStates, { awaitingHuman: 1, verifyResolution: 0, unsent: 1, awaitingAgent: 0 });
  assert.equal(d.review.counts.threads.open, 2);
});
