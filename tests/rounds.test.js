import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { world, HUMAN, agent, editLines } from './_world.js';
import { gitDirSig, lines } from './_git.js';
import * as reviews from '../src/reviews.js';
import * as rounds from '../src/rounds.js';
import * as threads from '../src/threads.js';
import * as store from '../src/store.js';

let w;
beforeEach(async () => { w = await world(); });
afterEach(() => w.cleanup());

const ok = (res) => { assert.equal(res.ok, true, JSON.stringify(res)); return res; };
const codeOf = (res) => { assert.equal(res.ok, false, 'expected a refusal'); return res.code; };
const open = async (args = {}) => ok(await reviews.openReview({ project: 'app', worktree: 'feature', ...args }, HUMAN)).review;
const say = async (id, startLine, body = 'x', actor = HUMAN) =>
  ok(await threads.annotate(id, actor, { anchor: { kind: 'lines', file: 'a.js', side: 'new', startLine, endLine: startLine }, kind: 'comment', body })).thread;
const withTop = (top, edits) => [...top, ...editLines(edits).split('\n')].join('\n');
const fileAt = async (id, round, file = 'a.js') => ok(await reviews.diff(id, { round, file })).files[0];
const where = (file) => Object.fromEntries(file.threads.map((t) => [t.id, t.anchor.startLine]));

/**
 * Three rounds of a.js. Round 1: t1 on `bottom-edit` (18), t2 on `top-edit` (2), t2 resolved.
 * Round 2: two lines inserted on top (t1 -> 20, t2 -> 4); t3 opened on 20; an agent replies on t1.
 * Round 3: one more line on top and the top rewritten: t1 -> 21, t3 -> 21, t2 outdated.
 */
async function threeRounds() {
  const wt = w.addWorktree();
  wt.commit({ 'a.js': editLines({ 2: 'top-edit', 18: 'bottom-edit' }) });
  const review = await open();
  const t1 = await say(review.id, 18);
  const t2 = await say(review.id, 2);
  ok(await threads.setThreadStatus(review.id, t2.id, { status: 'resolved' }));
  wt.commit({ 'a.js': withTop(['ins1', 'ins2'], { 2: 'top-edit', 18: 'bottom-edit' }) });
  ok(await reviews.refreshReview(review.id, HUMAN));
  const t3 = await say(review.id, 20);
  ok(await threads.reply(review.id, agent('s-a'), t1.id, { body: 'round-2 reply' }));
  wt.commit({ 'a.js': withTop(['ins1', 'ins2', 'ins3'], { 1: 'r1', 2: 'r2', 3: 'r3', 4: 'r4', 5: 'r5', 18: 'bottom-edit' }) });
  assert.equal(ok(await reviews.refreshReview(review.id, HUMAN)).threads.outdated, 1);
  return { wt, review, t1, t2, t3 };
}

test('each round of a range review shows its own diff with the threads where they sat in that round', async () => {
  const { review, t1, t2, t3 } = await threeRounds();
  assert.deepEqual(where(await fileAt(review.id, 1)), { [t1.id]: 18, [t2.id]: 2 });
  assert.deepEqual(where(await fileAt(review.id, 2)), { [t1.id]: 20, [t2.id]: 4, [t3.id]: 20 });
  assert.deepEqual(where(await fileAt(review.id, 3)), { [t1.id]: 21, [t3.id]: 21 });
  const r1 = await fileAt(review.id, 1);
  assert.ok(r1.threads.every((t) => t.anchor.round === 1));
  assert.ok(r1.hunks.some((h) => h.lines.some((l) => l.text === 'top-edit')), 'round 1 hunks are round 1\'s');
});

test('a thread opened in round 2 is absent from round 1, and a round-2 reply is hidden there but counted', async () => {
  const { review, t1, t3 } = await threeRounds();
  const r1 = (await fileAt(review.id, 1)).threads;
  assert.equal(r1.find((t) => t.id === t3.id), undefined);
  const t1then = r1.find((t) => t.id === t1.id);
  assert.deepEqual(t1then.messages.map((m) => m.round), [1]);
  assert.equal(t1then.laterMessages, 1);
  assert.equal((await fileAt(review.id, 2)).threads.find((t) => t.id === t1.id).laterMessages, 0);
});

test('a thread outdated in round 3 shows its pre-outdated status before, and is outdated at its round-2 position from round 3', async () => {
  const { review, t2 } = await threeRounds();
  assert.equal((await fileAt(review.id, 2)).threads.find((t) => t.id === t2.id).status, 'resolved');
  const r2 = ok(await rounds.roundView(review.id, '2'));
  assert.deepEqual(r2.outdatedThreads, []);
  const r3 = ok(await rounds.roundView(review.id, '3'));
  assert.deepEqual(r3.outdatedThreads.map((t) => [t.id, t.status, t.anchor.round, t.anchor.startLine]), [[t2.id, 'outdated', 2, 4]]);
});

test('the round view lists that round\'s files and counts threads as of then, with no verdicts and nothing unread', async () => {
  const { review, t1 } = await threeRounds();
  ok(await threads.reply(review.id, agent('s-a'), t1.id, { body: 'unread now' }));
  const r1 = ok(await rounds.roundView(review.id, '1'));
  assert.equal(r1.readOnly, true);
  assert.equal(r1.round.n, 1);
  assert.equal(r1.round.headSha, review.headSha);
  assert.deepEqual(r1.counts, { open: 1, resolved: 1, outdated: 0 });
  assert.deepEqual(r1.files.map((f) => [f.path, f.verdicts, f.threads, f.unread]), [['a.js', null, { open: 1, resolved: 1, outdated: 0 }, 0]]);
  assert.deepEqual(ok(await rounds.roundView(review.id, '3')).counts, { open: 2, resolved: 0, outdated: 1 });
});

test('a past round\'s hunks carry no verdict even when the current round has verdicts on the same hunks', async () => {
  const wt = w.addWorktree();
  wt.commit({ 'a.js': editLines({ 2: 'top-edit' }) });
  const review = await open();
  const [h] = ok(await reviews.diff(review.id, {})).files[0].hunks;
  ok(await reviews.setVerdict(review.id, h.id, 'accepted'));
  wt.commit({ 'b.js': 'other\n' });
  ok(await reviews.refreshReview(review.id, HUMAN));
  const r1 = await fileAt(review.id, 1);
  assert.equal(r1.hunks[0].id, h.id);
  assert.equal(r1.hunks[0].verdict, null);
  assert.equal(r1.verdicts, null);
});

test('a renamed file: round 1 shows the thread under the old path, round 2 under the new one', async () => {
  const wt = w.addWorktree();
  wt.commit({ 'a.js': editLines({ 18: 'bottom-edit' }) });
  const review = await open();
  const t = await say(review.id, 18);
  wt.commit({ 'a.js': null, 'z.js': editLines({ 18: 'bottom-edit', 19: 'more' }) });
  ok(await reviews.refreshReview(review.id, HUMAN));
  assert.deepEqual(where(await fileAt(review.id, 1, 'a.js')), { [t.id]: 18 });
  assert.deepEqual(where(await fileAt(review.id, 2, 'z.js')), { [t.id]: 18 });
  assert.equal(codeOf(await reviews.diff(review.id, { round: '1', file: 'z.js' })), 'FILE_NOT_IN_DIFF');
});

test('diff with a round and no file lists every file of that round', async () => {
  const { review } = await threeRounds();
  const res = ok(await reviews.diff(review.id, { round: '1' }));
  assert.equal(res.readOnly, true);
  assert.equal(res.round.n, 1);
  assert.deepEqual(res.files.map((f) => f.path), ['a.js']);
});

test('file lines with a round read that round\'s content; without one, the current round', async () => {
  const { review } = await threeRounds();
  const text = async (round) => ok(await reviews.fileLines(review.id, { path: 'a.js', side: 'new', start: 1, end: 2, round })).lines.map((l) => l.text);
  assert.deepEqual(await text('1'), ['l1', 'top-edit']);
  assert.deepEqual(await text('2'), ['ins1', 'ins2']);
  assert.deepEqual(await text(undefined), ['ins1', 'ins2']);
  assert.equal(ok(await reviews.fileLines(review.id, { path: 'a.js', round: '1' })).total, 20);
  assert.equal(ok(await reviews.fileLines(review.id, { path: 'a.js' })).total, 23);
});

test('round refusals: non-range reviews, malformed rounds, commit with round, unknown rounds and reviews', async () => {
  const { review } = await threeRounds();
  for (const bad of ['0', 'x', '-1', '01', '1.0', '', ' 1']) {
    assert.equal(codeOf(await rounds.roundView(review.id, bad)), 'INVALID_ARGUMENT', bad);
    assert.equal(codeOf(await reviews.diff(review.id, { round: bad })), 'INVALID_ARGUMENT', bad);
    assert.equal(codeOf(await reviews.fileLines(review.id, { path: 'a.js', round: bad })), 'INVALID_ARGUMENT', bad);
  }
  assert.equal(codeOf(await reviews.diff(review.id, { round: '1', commit: review.headSha })), 'INVALID_ARGUMENT');
  assert.equal(codeOf(await rounds.roundView(review.id, '4')), 'ROUND_UNKNOWN');
  assert.equal(codeOf(await reviews.diff(review.id, { round: '99' })), 'ROUND_UNKNOWN');
  assert.equal(codeOf(await reviews.fileLines(review.id, { path: 'a.js', round: '99' })), 'ROUND_UNKNOWN');
  assert.equal(codeOf(await reviews.diff(review.id, { round: '1', file: 'nope.js' })), 'FILE_NOT_IN_DIFF');
  assert.equal(codeOf(await rounds.roundView('r-0000000000', '1')), 'REVIEW_UNKNOWN');
  ok(await rounds.roundView(review.id, 1));
});

test('commit and uncommitted reviews have no round views', async () => {
  const wt = w.addWorktree();
  wt.commit({ 'a.js': editLines({ 2: 'top-edit' }) });
  const commit = await open({ kind: 'commit' });
  wt.write('a.js', editLines({ 2: 'live' }));
  const uncommitted = await open({ kind: 'uncommitted' });
  for (const r of [commit, uncommitted]) {
    assert.equal(codeOf(await rounds.roundView(r.id, '1')), 'INVALID_ARGUMENT', r.kind);
    assert.equal(codeOf(await reviews.diff(r.id, { round: '1' })), 'INVALID_ARGUMENT', r.kind);
    assert.equal(codeOf(await reviews.fileLines(r.id, { path: 'a.js', round: '1' })), 'INVALID_ARGUMENT', r.kind);
  }
});

test('a past round stays readable through the main checkout once the worktree is gone', async () => {
  const { wt, review, t1, t2 } = await threeRounds();
  wt.destroy();
  assert.deepEqual(where(await fileAt(review.id, 1)), { [t1.id]: 18, [t2.id]: 2 });
  assert.equal(ok(await rounds.roundView(review.id, '1')).files.length, 1);
  assert.deepEqual(ok(await reviews.fileLines(review.id, { path: 'a.js', start: 2, end: 2, round: '1' })).lines.map((l) => l.text), ['top-edit']);
});

// A round recorded by an earlier server process: its snapshot is not in this process's cache, so reading it runs git.
async function coldRounds(checkout, review) {
  const heads = [checkout.commit({ 'a.js': editLines({ 2: 'top-edit', 9: 'cold-1' }) }), checkout.commit({ 'a.js': editLines({ 2: 'top-edit', 9: 'cold-2' }) })];
  await store.mutate(review.id, (r) => {
    const base = r.rounds[0].baseSha;
    for (const headSha of heads) r.rounds.push({ n: r.rounds.length + 1, baseSha: base, headSha, fingerprint: 'cold', createdAt: '', submittedAt: null });
  });
}

async function readRound2(id) {
  assert.ok(ok(await rounds.roundView(id, '2')).files.length);
  assert.ok((await fileAt(id, '2')).hunks.some((h) => h.lines.some((l) => l.text === 'cold-1')));
  assert.deepEqual(ok(await reviews.fileLines(id, { path: 'a.js', side: 'new', start: 9, end: 9, round: '2' })).lines.map((l) => l.text), ['cold-1']);
  ok(await reviews.fileLines(id, { path: 'a.js', side: 'old', start: 1, end: 3, round: '2' }));
}

test('reading a past round leaves the main checkout\'s .git byte-identical', async () => {
  const first = w.repo.git('rev-parse', 'HEAD');
  w.repo.commit({ 'a.js': editLines({ 2: 'top-edit' }) });
  const review = await open({ worktree: null, base: first });
  await coldRounds(w.repo, review);
  const before = gitDirSig(w.repo.dir);
  await readRound2(review.id);
  assert.deepEqual(gitDirSig(w.repo.dir), before);
});

// A linked worktree's own `.git` is a pointer file; its index, HEAD and the shared objects live in the common git dir
// (`<main>/.git`, including `worktrees/<name>/`), so that is what must stay untouched.
test('reading a past round of a linked worktree leaves the common git dir, its worktrees/ entry included, byte-identical', async () => {
  const wt = w.addWorktree();
  wt.commit({ 'a.js': editLines({ 2: 'top-edit' }) });
  const review = await open();
  await coldRounds(wt, review);
  const before = gitDirSig(w.repo.dir);
  assert.ok(before.some((e) => /^\.git\/worktrees\/[^/]+\/index /.test(e)), 'the signature covers the worktree\'s own index');
  await readRound2(review.id);
  assert.deepEqual(gitDirSig(w.repo.dir), before);
});

const POSITIONAL = ['drifted', 'endLine', 'file', 'hunkId', 'kind', 'linesHash', 'round', 'side', 'startLine'];

test('every served thread anchor is positional only: no stored lines or context hashes leak to the API', async () => {
  const { review, t1 } = await threeRounds();
  const served = [
    ...ok(await reviews.diff(review.id, {})).files.flatMap((f) => f.threads),
    ...ok(await reviews.getReview(review.id)).outdatedThreads,
    ...(await fileAt(review.id, 1)).threads,
    ...ok(await rounds.roundView(review.id, '3')).outdatedThreads,
    ok(await threads.annotate(review.id, HUMAN, { anchor: { kind: 'lines', file: 'a.js', side: 'new', startLine: 21 }, kind: 'comment', body: 'y' })).thread,
  ];
  assert.ok(served.length >= 6);
  for (const t of served) assert.deepEqual(Object.keys(t.anchor).sort(), POSITIONAL, t.id);
});

// ---- file and review threads as of a round ----

const note = async (id, anchor) => ok(await threads.annotate(id, HUMAN, { anchor, kind: 'comment', body: 'x' })).thread;

test('a round view lists the review threads opened by then: none before the thread\'s round, the thread from it on', async () => {
  // Invariant: rounds/:n reviewThreads is threadsAt(n) filtered to review anchors, so a thread first appears in its own round.
  const wt = w.addWorktree();
  wt.commit({ 'a.js': editLines({ 2: 'top-edit' }) });
  const review = await open();
  wt.commit({ 'a.js': editLines({ 2: 'top-edit', 18: 'bottom-edit' }) });
  ok(await reviews.refreshReview(review.id, HUMAN));
  const r = await note(review.id, { kind: 'review' });
  await note(review.id, { kind: 'file', file: 'a.js' });
  wt.commit({ 'b.js': 'other\n' });
  ok(await reviews.refreshReview(review.id, HUMAN));
  const ids = async (n) => ok(await rounds.roundView(review.id, n)).reviewThreads.map((t) => [t.id, t.anchor.kind]);
  assert.deepEqual(await ids(1), []);
  assert.deepEqual(await ids(2), [[r.id, 'review']]);
  assert.deepEqual(await ids(3), [[r.id, 'review']]);
});

test('a past round\'s diff places a file thread on that round\'s path: the pre-rename path before the rename', async () => {
  // Invariant: roundThreadsOn reads the file anchor of round n from pastAnchors, so the thread sits on the path it had then.
  const wt = w.addWorktree();
  wt.commit({ 'b.js': lines(10, 'b').replace('b1\n', 'b1-edit\n') });
  const review = await open();
  const t = await note(review.id, { kind: 'file', file: 'b.js' });
  wt.git('mv', 'b.js', 'c.js');
  wt.commit({});
  ok(await reviews.refreshReview(review.id, HUMAN));
  assert.deepEqual((await fileAt(review.id, 1, 'b.js')).threads.map((x) => [x.id, x.anchor]), [[t.id, { kind: 'file', file: 'b.js', round: 1 }]]);
  assert.deepEqual((await fileAt(review.id, 2, 'c.js')).threads.map((x) => [x.id, x.anchor]), [[t.id, { kind: 'file', file: 'c.js', round: 2 }]]);
});
