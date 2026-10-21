import { test, beforeEach, afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { world, HUMAN, agent, editLines } from './_world.js';
import { gitDirSig, lines } from './_git.js';
import * as reviews from '../src/reviews.js';
import * as threads from '../src/threads.js';
import * as store from '../src/store.js';
import { placeThreads, compareRounds } from '../src/compare.js';

// ---- placeThreads: pure, over stored-shape fixtures (as in history.test.js) ----

const pos = (round, startLine, extra = {}) => ({
  file: 'a.js', side: 'new', startLine, endLine: startLine, hunkId: `h${round}`, round, linesHash: `x${startLine}`, drifted: false, ...extra,
});
const stored = (round, startLine, extra) => ({ ...pos(round, startLine, extra), lines: ['x'], ctxBefore: { hash: 'b', n: 1 }, ctxAfter: { hash: 'a', n: 1 } });
let seq = 0;
const msg = (round) => ({ id: `m${++seq}`, seq, author: { kind: 'session', sessionId: 's', role: 'author' }, body: 'b', at: '', round, proposeResolve: false });
const thread = (id, over = {}) => ({
  id, kind: 'comment', severity: null, status: 'open', disposition: null, resolution: null, resolveProposed: false,
  statusSeq: 1, openedBy: { kind: 'human' }, humanReadSeq: 0, createdAt: '', messages: [msg(1)], pastAnchors: [], anchor: stored(1, 5),
  ...over,
});
const hunk = (id, oldStart, oldLines, newStart, newLines) => ({ id, kind: 'text', oldStart, oldLines, newStart, newLines, lines: [] });
const file = (path, over = {}) => ({
  path, oldPath: null, status: 'modified', binary: false, tooLarge: false, additions: 1, deletions: 1, hunks: [hunk('c1', 3, 3, 3, 1)], ...over,
});
const place = (threadList, from, to, files) => placeThreads({ review: { threads: threadList }, from, to, files });
const copiesIn = (res, path) => (res.byFile.get(path) ?? []).map((c) => [c.id, c.placement]);
const copy = (res, path, id, placement) => res.byFile.get(path).find((c) => c.id === id && c.placement === placement);

describe('placeThreads', () => {
  test('a from-copy keeps its round-A lines on the old side and a to-copy its round-B lines on the new side, with the compare file\'s hunk', () => {
    const t = thread('t1', { pastAnchors: [pos(1, 4)], anchor: stored(2, 9) });
    const ctx = thread('t2', { pastAnchors: [pos(1, 15)], anchor: stored(2, 15) });
    const res = place([t, ctx], 1, 2, [file('a.js', { hunks: [hunk('c1', 3, 3, 3, 1), hunk('c2', 8, 1, 6, 4)] })]);
    assert.deepEqual(copy(res, 'a.js', 't1', 'from').anchor,
      { file: 'a.js', side: 'old', startLine: 4, endLine: 4, hunkId: 'c1', round: 1, linesHash: 'x4', drifted: false });
    assert.deepEqual(copy(res, 'a.js', 't1', 'to').anchor,
      { file: 'a.js', side: 'new', startLine: 9, endLine: 9, hunkId: 'c2', round: 2, linesHash: 'x9', drifted: false });
    // Line 15 is in no compare hunk on either side: pure context.
    assert.equal(copy(res, 'a.js', 't2', 'from').anchor.hunkId, null);
    assert.equal(copy(res, 'a.js', 't2', 'to').anchor.hunkId, null);
    assert.deepEqual(res.unplaced, []);
  });

  test('a thread opened after A has only a to-copy; one opened after B and one outdated before A are absent everywhere', () => {
    const later = thread('t1', { messages: [msg(3)], anchor: stored(3, 5) });
    const afterB = thread('t2', { messages: [msg(4)], anchor: stored(4, 5) });
    const gone = thread('t3', { status: 'outdated', anchor: stored(1, 5) });
    const res = place([later, afterB, gone], 2, 3, [file('a.js')]);
    assert.deepEqual(copiesIn(res, 'a.js'), [['t1', 'to']]);
    assert.deepEqual(res.unplaced, []);
    assert.deepEqual(res.counts, { open: 1, resolved: 0, outdated: 0 });
  });

  test('a thread outdated between A and B has a from-copy only, outdated in the round after its last located one; through B inclusive', () => {
    // Last located in round 2, so outdated from round 3.
    const t = thread('t1', { status: 'outdated', pastAnchors: [pos(1, 5)], anchor: stored(2, 6) });
    const wide = place([t], 1, 4, [file('a.js')]);
    assert.deepEqual(copiesIn(wide, 'a.js'), [['t1', 'from']]);
    assert.equal(copy(wide, 'a.js', 't1', 'from').outdatedIn, 3);
    assert.equal(copy(wide, 'a.js', 't1', 'from').status, 'open', 'the from-copy shows its status as of A');
    const atB = place([t], 2, 3, [file('a.js')]);
    assert.equal(copy(atB, 'a.js', 't1', 'from').outdatedIn, 3, 'outdated in B itself still counts');
  });

  test('a thread outdated only after B, or never, has outdatedIn null and a to-copy; a to-copy never carries outdatedIn', () => {
    const laterOutdated = thread('t1', { status: 'outdated', pastAnchors: [pos(1, 5)], anchor: stored(2, 6) });
    const live = thread('t2', { pastAnchors: [pos(1, 7)], anchor: stored(2, 7) });
    const res = place([laterOutdated, live], 1, 2, [file('a.js')]);
    assert.deepEqual(copiesIn(res, 'a.js'), [['t1', 'from'], ['t1', 'to'], ['t2', 'from'], ['t2', 'to']]);
    for (const c of res.byFile.get('a.js')) assert.equal(c.outdatedIn, null, `${c.id} ${c.placement}`);
  });

  test('a from-copy\'s messages stop at A and a to-copy\'s at B, later ones counted; neither is unread', () => {
    const t = thread('t1', { messages: [msg(1), msg(2), msg(3)], pastAnchors: [pos(1, 5), pos(2, 5)], anchor: stored(3, 5) });
    const res = place([t], 1, 2, [file('a.js')]);
    const from = copy(res, 'a.js', 't1', 'from');
    const to = copy(res, 'a.js', 't1', 'to');
    assert.deepEqual([from.messages.length, from.laterMessages], [1, 2]);
    assert.deepEqual([to.messages.length, to.laterMessages], [2, 1]);
    assert.deepEqual([from.unread, to.unread], [0, 0]);
  });

  test('base-side, unchanged-file and no-lines copies are unplaced, each thread once, as its to-copy when it has one', () => {
    const base = thread('t1', { pastAnchors: [pos(1, 5, { side: 'old' })], anchor: stored(2, 5, { side: 'old' }) });
    const elsewhere = thread('t2', { pastAnchors: [pos(1, 5, { file: 'c.js' })], anchor: stored(2, 5, { file: 'c.js' }) });
    const binary = thread('t3', { pastAnchors: [pos(1, 5, { file: 'bin' })], anchor: stored(2, 5, { file: 'bin' }) });
    const big = thread('t4', { pastAnchors: [pos(1, 5, { file: 'big' })], anchor: stored(2, 5, { file: 'big' }) });
    const res = place([base, elsewhere, binary, big], 1, 2, [file('a.js'), file('bin', { binary: true }), file('big', { tooLarge: true })]);
    assert.deepEqual(res.unplaced.map((c) => [c.id, c.placement, c.reason]),
      [['t1', 'to', 'base-side'], ['t2', 'to', 'unchanged-file'], ['t3', 'to', 'no-lines'], ['t4', 'to', 'no-lines']]);
    assert.equal(res.unplaced[0].anchor.side, 'old', 'an unplaced copy keeps its own anchor');
    assert.equal(res.unplaced[1].anchor.file, 'c.js');
    assert.deepEqual([...res.byFile.values()].flat(), []);
  });

  test('a thread with no to-copy is unplaced as its from-copy; the to-copy wins even when the from-copy has a different reason', () => {
    const outdatedBase = thread('t1', { status: 'outdated', anchor: stored(1, 5, { side: 'old' }) });
    // from-copy: a.js is added in the comparison, so it has no round-A side (unchanged-file); to-copy: binary (no-lines).
    const t2 = thread('t2', { pastAnchors: [pos(1, 5)], anchor: stored(2, 5) });
    const res = place([outdatedBase, t2], 1, 2, [file('a.js', { status: 'added', binary: true })]);
    assert.deepEqual(res.unplaced.map((c) => [c.id, c.placement, c.reason, c.outdatedIn]),
      [['t1', 'from', 'base-side', 2], ['t2', 'to', 'no-lines', null]]);
  });

  test('a thread with one placed copy is never unplaced; from-copies skip added files and to-copies skip deleted ones', () => {
    const t = thread('t1', { pastAnchors: [pos(1, 5)], anchor: stored(2, 5) });
    const added = place([t], 1, 2, [file('a.js', { status: 'added' })]);
    assert.deepEqual(copiesIn(added, 'a.js'), [['t1', 'to']]);
    assert.deepEqual(added.unplaced, []);
    const deleted = place([t], 1, 2, [file('a.js', { status: 'deleted' })]);
    assert.deepEqual(copiesIn(deleted, 'a.js'), [['t1', 'from']]);
    assert.deepEqual(deleted.unplaced, []);
  });

  test('a rename between the rounds: the from-copy matches through oldPath and both copies sit under the new path', () => {
    const t = thread('t1', { pastAnchors: [pos(1, 5, { file: 'a.js' })], anchor: stored(2, 6, { file: 'z.js' }) });
    const res = place([t], 1, 2, [file('z.js', { oldPath: 'a.js', status: 'renamed' })]);
    assert.deepEqual(copiesIn(res, 'z.js'), [['t1', 'from'], ['t1', 'to']]);
    assert.equal(copy(res, 'z.js', 't1', 'from').anchor.file, 'z.js');
    // A file renamed from elsewhere to the thread's round-A path is not where the round-A lines were.
    const other = place([t], 1, 2, [file('a.js', { oldPath: 'q.js', status: 'renamed' }), file('z.js')]);
    assert.deepEqual(copiesIn(other, 'a.js'), []);
    assert.deepEqual(other.unplaced.map((c) => c.id), [], 'the to-copy still places in z.js');
  });

  test('counts tally the compared threads as of B, outdated-between included and threads outside both rounds excluded', () => {
    const open = thread('t1', { pastAnchors: [pos(1, 5), pos(2, 5)], anchor: stored(3, 5) });
    const resolved = thread('t2', { status: 'resolved', resolution: { by: { kind: 'human' }, seq: 3 }, pastAnchors: [pos(1, 5), pos(2, 5)], anchor: stored(3, 5) });
    const between = thread('t3', { status: 'outdated', pastAnchors: [pos(1, 5)], anchor: stored(2, 5) });
    const before = thread('t4', { status: 'outdated', anchor: stored(1, 5) });
    const fresh = thread('t5', { messages: [msg(3)], anchor: stored(3, 5) });
    const afterB = thread('t6', { messages: [msg(4)], anchor: stored(4, 5) });
    const res = place([open, resolved, between, before, fresh, afterB], 2, 3, [file('a.js')]);
    assert.deepEqual(res.counts, { open: 2, resolved: 1, outdated: 1 });
  });

  test('counts include threads served only in unplaced: base-side, unchanged-file, no-lines, and one outdated between A and B', () => {
    const placedOpen = thread('t1', { pastAnchors: [pos(1, 5)], anchor: stored(2, 5) });
    const base = thread('t2', { pastAnchors: [pos(1, 5, { side: 'old' })], anchor: stored(2, 5, { side: 'old' }) });
    const elsewhere = thread('t3', { status: 'resolved', resolution: { by: { kind: 'human' }, seq: 3 }, pastAnchors: [pos(1, 5, { file: 'c.js' })], anchor: stored(2, 5, { file: 'c.js' }) });
    const binary = thread('t4', { pastAnchors: [pos(1, 5, { file: 'bin' })], anchor: stored(2, 5, { file: 'bin' }) });
    const goneBase = thread('t5', { status: 'outdated', anchor: stored(1, 5, { side: 'old' }) });
    const res = place([placedOpen, base, elsewhere, binary, goneBase], 1, 2, [file('a.js'), file('bin', { binary: true })]);
    assert.deepEqual(res.unplaced.map((c) => c.id), ['t2', 't3', 't4', 't5'], 'every thread but t1 is served only in unplaced');
    assert.deepEqual(res.counts, { open: 3, resolved: 1, outdated: 1 });
  });

  test('per-file lists and unplaced are ordered by thread number, a thread\'s from-copy before its to-copy', () => {
    const mk = (id, side = 'new') => thread(id, { pastAnchors: [pos(1, 5, { side })], anchor: stored(2, 5, { side }) });
    const res = place([mk('t10'), mk('t2'), mk('t1'), mk('t11', 'old'), mk('t3', 'old')], 1, 2, [file('a.js')]);
    assert.deepEqual(copiesIn(res, 'a.js'), [['t1', 'from'], ['t1', 'to'], ['t2', 'from'], ['t2', 'to'], ['t10', 'from'], ['t10', 'to']]);
    assert.deepEqual(res.unplaced.map((c) => c.id), ['t3', 't11']);
  });

  test('placing threads does not modify the stored review', () => {
    const review = { threads: [thread('t1', { status: 'outdated', pastAnchors: [pos(1, 5)], anchor: stored(2, 6) })] };
    const before = structuredClone(review);
    placeThreads({ review, from: 1, to: 3, files: [file('a.js')] });
    assert.deepEqual(review, before);
  });
});

// ---- compareRounds over real git ----

let w;
beforeEach(async () => { w = await world(); });
afterEach(() => w.cleanup());

const ok = (res) => { assert.equal(res.ok, true, JSON.stringify(res)); return res; };
const codeOf = (res) => { assert.equal(res.ok, false, 'expected a refusal'); return res.code; };
const open = async (args = {}) => ok(await reviews.openReview({ project: 'app', worktree: 'feature', ...args }, HUMAN)).review;
const say = async (id, startLine, body = 'x', side = 'new') =>
  ok(await threads.annotate(id, HUMAN, { anchor: { file: 'a.js', side, startLine, endLine: startLine }, kind: 'comment', body })).thread;
const withTop = (top, edits) => [...top, ...editLines(edits).split('\n')].join('\n');
const compare = async (id, from, to) => ok(await compareRounds(id, { from, to }));
const changed = (f) => f.hunks.flatMap((h) => h.lines.filter((l) => l.t !== 'ctx').map((l) => `${l.t === 'add' ? '+' : '-'}${l.text}`));
const placed = (f) => f.threads.map((t) => [t.id, t.placement, t.anchor.side, t.anchor.startLine]);

/**
 * threeRounds of rounds.test.js, plus b.js edited in round 1 only. Round 1: t1 on 18, t2 on 2 (resolved).
 * Round 2: two lines on top (t1 -> 20, t2 -> 4); t3 on 20; an agent replies on t1. Round 3: one more line on top and
 * the top rewritten: t1 -> 21, t3 -> 21, t2 outdated.
 */
async function threeRounds() {
  const wt = w.addWorktree();
  wt.commit({ 'a.js': editLines({ 2: 'top-edit', 18: 'bottom-edit' }), 'b.js': 'b-edit\n' });
  const review = await open();
  const t1 = await say(review.id, 18);
  const t2 = await say(review.id, 2);
  ok(await threads.setThreadStatus(review.id, t2.id, { status: 'resolved' }));
  wt.commit({ 'a.js': withTop(['ins1', 'ins2'], { 2: 'top-edit', 18: 'bottom-edit' }) });
  ok(await reviews.refreshReview(review.id));
  const t3 = await say(review.id, 20);
  ok(await threads.reply(review.id, agent('s-a'), t1.id, { body: 'round-2 reply' }));
  wt.commit({ 'a.js': withTop(['ins1', 'ins2', 'ins3'], { 1: 'r1', 2: 'r2', 3: 'r3', 4: 'r4', 5: 'r5', 18: 'bottom-edit' }) });
  assert.equal(ok(await reviews.refreshReview(review.id)).threads.outdated, 1);
  return { wt, review, t1, t2, t3 };
}

test('the comparison diffs round A\'s head against round B\'s: only what changed between them, files untouched since absent', async () => {
  const { review } = await threeRounds();
  const res = await compare(review.id, '1', '3');
  assert.equal(res.readOnly, true);
  assert.deepEqual([res.from.n, res.to.n], [1, 3]);
  assert.equal(res.from.headSha, review.headSha);
  assert.deepEqual(res.files.map((f) => f.path), ['a.js'], 'b.js is unchanged since round 1');
  const a = changed(res.files[0]);
  for (const line of ['+ins1', '+ins3', '+r1', '+r5', '-top-edit', '-l1']) assert.ok(a.includes(line), line);
  assert.ok(!a.some((l) => l.endsWith('bottom-edit')), 'the base edit both rounds share is not a change');
  const f = res.files[0];
  assert.deepEqual([f.verdicts, f.unread, f.status], [null, 0, 'modified']);
  assert.ok(f.hunks.every((h) => h.verdict === null));
});

test('round-A threads sit at their round-A lines on the old side, round-B threads at their round-B lines on the new side', async () => {
  const { review, t1, t2, t3 } = await threeRounds();
  const res = await compare(review.id, '1', '3');
  assert.deepEqual(placed(res.files[0]), [
    [t1.id, 'from', 'old', 18], [t1.id, 'to', 'new', 21], [t2.id, 'from', 'old', 2], [t3.id, 'to', 'new', 21],
  ]);
  const byKey = Object.fromEntries(res.files[0].threads.map((t) => [`${t.id}/${t.placement}`, t]));
  assert.deepEqual([byKey[`${t2.id}/from`].outdatedIn, byKey[`${t2.id}/from`].status], [3, 'resolved']);
  assert.equal(byKey[`${t1.id}/from`].outdatedIn, null);
  assert.deepEqual([byKey[`${t1.id}/from`].messages.length, byKey[`${t1.id}/from`].laterMessages], [1, 1]);
  assert.deepEqual([byKey[`${t1.id}/to`].messages.length, byKey[`${t1.id}/to`].laterMessages], [2, 0]);
  assert.deepEqual(res.counts, { open: 2, resolved: 0, outdated: 1 });
  assert.deepEqual(res.unplaced, []);
  // Rounds 2 -> 3: t2 sat on line 4 in round 2.
  assert.ok(placed((await compare(review.id, '2', '3')).files[0]).some((p) => p.join() === [t2.id, 'from', 'old', 4].join()));
});

test('a base-side thread is unplaced with its reason', async () => {
  const wt = w.addWorktree();
  wt.commit({ 'a.js': editLines({ 2: 'top-edit', 8: 'eight' }) });
  const review = await open();
  const t = await say(review.id, 8, 'base', 'old');
  wt.commit({ 'a.js': editLines({ 2: 'top-edit-2', 8: 'eight' }) });
  ok(await reviews.refreshReview(review.id));
  const res = await compare(review.id, '1', '2');
  assert.deepEqual(res.unplaced.map((u) => [u.id, u.placement, u.reason]), [[t.id, 'to', 'base-side']]);
  assert.deepEqual(res.files[0].threads, []);
  assert.deepEqual(res.counts, { open: 1, resolved: 0, outdated: 0 }, 'an unplaced thread still counts');
});

test('only files either round reviews: an upstream change merged in between is absent, a file reverted to base in B is present', async () => {
  const wt = w.addWorktree();
  wt.commit({ 'a.js': editLines({ 2: 'top-edit' }), 'b.js': 'b-edit\n' });
  const review = await open();
  w.repo.commit({ 'up.js': 'upstream\n' });
  wt.git('merge', '-q', '--no-edit', 'main');
  wt.commit({ 'a.js': editLines({ 2: 'top-edit-2' }), 'b.js': lines(10, 'b'), 'c.js': 'new in round 2\n' });
  ok(await reviews.refreshReview(review.id));
  assert.deepEqual(ok(await reviews.diff(review.id, {})).files.map((f) => f.path).sort(), ['a.js', 'c.js'], 'round B does not review b.js');
  const res = await compare(review.id, '1', '2');
  assert.deepEqual(res.files.map((f) => f.path).sort(), ['a.js', 'b.js', 'c.js'], 'c.js is reviewed by round B only');
  assert.deepEqual(changed(res.files.find((f) => f.path === 'b.js')).slice(0, 2), ['-b-edit', '+b1']);
});

test('a file reviewed in A and back at base content in B is in the comparison, its round-A thread placed on the old side', async () => {
  const wt = w.addWorktree();
  wt.commit({ 'a.js': editLines({ 2: 'top-edit' }), 'b.js': lines(10, 'b').replace('b3\n', 'b-edit\n') });
  const review = await open();
  const t = ok(await threads.annotate(review.id, HUMAN, { anchor: { file: 'b.js', side: 'new', startLine: 3, endLine: 3 }, kind: 'comment', body: 'b' })).thread;
  wt.commit({ 'a.js': editLines({ 2: 'top-edit' }), 'b.js': lines(10, 'b') });
  ok(await reviews.refreshReview(review.id));
  assert.deepEqual(ok(await reviews.diff(review.id, {})).files.map((f) => f.path), ['a.js'], 'round B does not review b.js');
  const res = await compare(review.id, '1', '2');
  assert.deepEqual(res.files.map((f) => [f.path, f.status]), [['b.js', 'modified']], 'a.js is unchanged between the rounds');
  assert.deepEqual(changed(res.files[0]), ['-b-edit', '+b3']);
  assert.deepEqual(res.files[0].threads.map((c) => [c.id, c.placement, c.anchor.side, c.anchor.startLine, c.outdatedIn]), [[t.id, 'from', 'old', 3, 2]]);
  assert.deepEqual(res.unplaced, []);
});

test('a rename reverted in B is present under B\'s path: round A reviewed it under the path it is renamed from', async () => {
  const wt = w.addWorktree();
  wt.commit({ 'a.js': editLines({ 2: 'top-edit' }), 'b.js': null, 'q.js': lines(10, 'b') });
  const review = await open();
  wt.commit({ 'a.js': editLines({ 2: 'top-edit-2' }), 'q.js': null, 'b.js': lines(10, 'b') });
  ok(await reviews.refreshReview(review.id));
  const res = await compare(review.id, '1', '2');
  assert.deepEqual(res.files.map((f) => [f.path, f.oldPath, f.status]).sort(), [['a.js', null, 'modified'], ['b.js', 'q.js', 'renamed']]);
});

test('a rename between the rounds is one file under round B\'s path, holding the from-copy and the to-copy', async () => {
  const wt = w.addWorktree();
  wt.commit({ 'a.js': editLines({ 18: 'bottom-edit' }) });
  const review = await open();
  const t = await say(review.id, 18);
  wt.commit({ 'a.js': null, 'z.js': editLines({ 18: 'bottom-edit', 19: 'more' }) });
  ok(await reviews.refreshReview(review.id));
  const res = await compare(review.id, '1', '2');
  assert.deepEqual(res.files.map((f) => [f.path, f.oldPath, f.status]), [['z.js', 'a.js', 'renamed']]);
  assert.deepEqual(placed(res.files[0]), [[t.id, 'from', 'old', 18], [t.id, 'to', 'new', 18]]);
  assert.ok(res.files[0].threads.every((c) => c.anchor.file === 'z.js'));
});

test('comparison refusals: from not before to, malformed rounds, non-range reviews, unknown rounds and reviews', async () => {
  const { review } = await threeRounds();
  assert.equal(codeOf(await compareRounds(review.id, { from: '2', to: '1' })), 'INVALID_ARGUMENT');
  assert.equal(codeOf(await compareRounds(review.id, { from: '2', to: '2' })), 'INVALID_ARGUMENT');
  for (const bad of ['0', 'x', '01', undefined]) {
    assert.equal(codeOf(await compareRounds(review.id, { from: bad, to: '3' })), 'INVALID_ARGUMENT', `from ${bad}`);
    assert.equal(codeOf(await compareRounds(review.id, { from: '1', to: bad })), 'INVALID_ARGUMENT', `to ${bad}`);
  }
  assert.equal(codeOf(await compareRounds(review.id, { from: '1', to: '9' })), 'ROUND_UNKNOWN');
  assert.equal(codeOf(await compareRounds(review.id, { from: '9', to: '10' })), 'ROUND_UNKNOWN');
  assert.equal(codeOf(await compareRounds('r-0000000000', { from: '1', to: '2' })), 'REVIEW_UNKNOWN');
  ok(await compareRounds(review.id, { from: 1, to: 2 }));
});

test('commit and uncommitted reviews have no comparison', async () => {
  const wt = w.addWorktree();
  wt.commit({ 'a.js': editLines({ 2: 'top-edit' }) });
  const commit = await open({ kind: 'commit' });
  wt.write('a.js', editLines({ 2: 'live' }));
  const uncommitted = await open({ kind: 'uncommitted' });
  for (const r of [commit, uncommitted]) assert.equal(codeOf(await compareRounds(r.id, { from: '1', to: '2' })), 'INVALID_ARGUMENT', r.kind);
});

test('a round whose head is no longer in the repository refuses SNAPSHOT_GONE', async () => {
  const { review } = await threeRounds();
  await store.mutate(review.id, (r) => {
    r.rounds.push({ n: 4, baseSha: r.rounds[0].baseSha, headSha: 'f'.repeat(40), fingerprint: 'gone', createdAt: '', submittedAt: null });
  });
  assert.equal(codeOf(await compareRounds(review.id, { from: '3', to: '4' })), 'SNAPSHOT_GONE');
});

test('a comparison stays readable through the main checkout once the worktree is gone', async () => {
  const { wt, review, t1 } = await threeRounds();
  wt.destroy();
  const res = await compare(review.id, '1', '3');
  assert.deepEqual(res.files.map((f) => f.path), ['a.js']);
  assert.ok(placed(res.files[0]).some((p) => p.join() === [t1.id, 'to', 'new', 21].join()));
});

// Rounds recorded by an earlier server process: their snapshots are not in this process's cache, so comparing runs git.
async function coldRounds(checkout, review) {
  const heads = [checkout.commit({ 'a.js': editLines({ 2: 'top-edit', 9: 'cold-1' }) }), checkout.commit({ 'a.js': editLines({ 2: 'top-edit', 9: 'cold-2' }) })];
  await store.mutate(review.id, (r) => {
    const base = r.rounds[0].baseSha;
    for (const headSha of heads) r.rounds.push({ n: r.rounds.length + 1, baseSha: base, headSha, fingerprint: 'cold', createdAt: '', submittedAt: null });
  });
}

async function compareCold(id) {
  const res = await compare(id, '2', '3');
  assert.deepEqual(changed(res.files[0]), ['-cold-1', '+cold-2']);
  ok(await reviews.fileLines(id, { path: 'a.js', side: 'new', start: 1, end: 3, round: '3' }));
}

test('comparing rounds leaves the main checkout\'s .git byte-identical', async () => {
  const first = w.repo.git('rev-parse', 'HEAD');
  w.repo.commit({ 'a.js': editLines({ 2: 'top-edit' }) });
  const review = await open({ worktree: null, base: first });
  await coldRounds(w.repo, review);
  const before = gitDirSig(w.repo.dir);
  await compareCold(review.id);
  assert.deepEqual(gitDirSig(w.repo.dir), before);
});

test('comparing rounds of a linked worktree leaves the common git dir, its worktrees/ entry included, byte-identical', async () => {
  const wt = w.addWorktree();
  wt.commit({ 'a.js': editLines({ 2: 'top-edit' }) });
  const review = await open();
  await coldRounds(wt, review);
  const before = gitDirSig(w.repo.dir);
  assert.ok(before.some((e) => /^\.git\/worktrees\/[^/]+\/index /.test(e)), 'the signature covers the worktree\'s own index');
  await compareCold(review.id);
  assert.deepEqual(gitDirSig(w.repo.dir), before);
});

const POSITIONAL = ['drifted', 'endLine', 'file', 'hunkId', 'linesHash', 'round', 'side', 'startLine'];

test('every anchor the comparison serves is positional only: no stored lines or context hashes leak', async () => {
  const { review } = await threeRounds();
  await say(review.id, 3, 'base', 'old');
  const res = await compare(review.id, '1', '3');
  const served = [...res.files.flatMap((f) => f.threads), ...res.unplaced];
  assert.ok(served.length >= 5);
  for (const t of served) assert.deepEqual(Object.keys(t.anchor).sort(), POSITIONAL, `${t.id} ${t.placement}`);
});
