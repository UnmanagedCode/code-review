import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { world, HUMAN, agent, editLines } from './_world.js';
import * as reviews from '../src/reviews.js';
import * as threads from '../src/threads.js';
import * as rounds from '../src/rounds.js';
import { compareRounds } from '../src/compare.js';
import * as store from '../src/store.js';

let w;
beforeEach(async () => { w = await world(); w.session('s-author', { worktree: 'feature' }); });
afterEach(() => w.cleanup());

const ok = (res) => { assert.equal(res.ok, true, JSON.stringify(res)); return res; };
const codeOf = (res) => { assert.equal(res.ok, false, 'expected a refusal'); return res.code; };

/** A range review whose a.js has two hunks and b.js one. */
async function twoHunks() {
  const wt = w.addWorktree();
  wt.commit({ 'a.js': editLines({ 2: 'top', 15: 'bottom' }), 'b.js': 'changed\n' });
  const { review } = ok(await reviews.openReview({ project: 'app', worktree: 'feature' }, HUMAN));
  return { wt, review };
}
const fileOf = async (id, path) => (await reviews.getReview(id)).files.find((f) => f.path === path);
const mark = (id, file, hunkIds) => reviews.setFileViewed(id, { file, hunkIds });

test('a marked file reads viewed; a refresh that changes one of its hunks clears the mark, an unchanged file keeps it', async () => {
  // Invariant: `viewed` is true only while the stored ids equal the file's current ones (the verdict survival rule).
  const { wt, review } = await twoHunks();
  const a = await fileOf(review.id, 'a.js');
  const b = await fileOf(review.id, 'b.js');
  assert.deepEqual([a.viewed, a.hunkIds.length, b.viewed], [false, 2, false]);
  ok(await mark(review.id, 'a.js', a.hunkIds));
  ok(await mark(review.id, 'b.js', b.hunkIds));
  assert.deepEqual([(await fileOf(review.id, 'a.js')).viewed, (await fileOf(review.id, 'b.js')).viewed], [true, true]);
  wt.commit({ 'a.js': editLines({ 2: 'top', 15: 'bottom changed' }) });
  ok(await reviews.refreshReview(review.id, HUMAN));
  assert.deepEqual([(await fileOf(review.id, 'a.js')).viewed, (await fileOf(review.id, 'b.js')).viewed], [false, true]);
});

test('a mismatched id set is refused STALE_HUNKS and writes nothing', async () => {
  // Invariant: the UI marks only the hunks it has shown, so a set that differs from the file's current ids is refused and the store is untouched.
  const { review } = await twoHunks();
  const a = await fileOf(review.id, 'a.js');
  const before = store.read(review.id);
  assert.equal(codeOf(await mark(review.id, 'a.js', [a.hunkIds[0]])), 'STALE_HUNKS');
  assert.equal(codeOf(await mark(review.id, 'a.js', [...a.hunkIds, 'ffffffffffff'])), 'STALE_HUNKS');
  assert.deepEqual(store.read(review.id), before);
});

test('refusals: INVALID_ARGUMENT, FILE_NOT_IN_DIFF, REVIEW_CLOSED', async () => {
  // Invariant: the checks run in order: argument shape, then open, then the file being in the diff.
  const { review } = await twoHunks();
  assert.equal(codeOf(await mark(review.id, '', [])), 'INVALID_ARGUMENT');
  assert.equal(codeOf(await mark(review.id, 'a.js', 'x')), 'INVALID_ARGUMENT');
  assert.equal(codeOf(await mark(review.id, 'a.js', [1])), 'INVALID_ARGUMENT');
  assert.equal(codeOf(await mark(review.id, 'nope.js', [])), 'FILE_NOT_IN_DIFF');
  ok(await reviews.patchReview(review.id, { status: 'closed' }));
  assert.equal(codeOf(await mark(review.id, 'a.js', [])), 'REVIEW_CLOSED');
});

test('marking is not activity: seq and lastActivityAt stay, rev bumps; null clears', async () => {
  // Invariant: setFileViewed never calls bump or touch, so the inbox order and "since you last looked" are unaffected.
  const { review } = await twoHunks();
  const a = await fileOf(review.id, 'a.js');
  const before = store.read(review.id);
  const res = ok(await mark(review.id, 'a.js', a.hunkIds));
  const after = store.read(review.id);
  assert.deepEqual([after.seq, after.lastActivityAt, after.humanSeq], [before.seq, before.lastActivityAt, before.humanSeq]);
  assert.ok(after.rev > before.rev);
  assert.equal(res.viewed, true);
  assert.equal(ok(await mark(review.id, 'a.js', null)).viewed, false);
  assert.equal((await fileOf(review.id, 'a.js')).viewed, false);
});

test('the returned fileSig equals the diff sig of the file', async () => {
  // Invariant: viewed and hunkIds feed `sig`, and the write answers the new sig so the UI's cached diff is patched.
  const { review } = await twoHunks();
  const a = await fileOf(review.id, 'a.js');
  const res = ok(await mark(review.id, 'a.js', a.hunkIds));
  const diffed = ok(await reviews.diff(review.id, { file: 'a.js' })).files[0];
  assert.equal(res.fileSig.sig, diffed.sig);
  assert.notEqual(res.fileSig.sig, a.sig);
});

test('an uncommitted review can mark files viewed', async () => {
  // Invariant: viewed marks are not verdicts, so they apply to uncommitted reviews too.
  w.repo.write('a.js', editLines({ 3: 'dirty' }));
  const { review } = ok(await reviews.openReview({ project: 'app', kind: 'uncommitted' }, HUMAN));
  const a = await fileOf(review.id, 'a.js');
  ok(await mark(review.id, 'a.js', a.hunkIds));
  assert.equal((await fileOf(review.id, 'a.js')).viewed, true);
});

test('commit-filter, past-round and compare views report viewed false', async () => {
  // Invariant: only the live round carries marks; the other views pass a review with no viewedFiles.
  const { wt, review } = await twoHunks();
  const a = await fileOf(review.id, 'a.js');
  ok(await mark(review.id, 'a.js', a.hunkIds));
  const sha = wt.commit({ 'c.js': 'c\n' });
  ok(await reviews.refreshReview(review.id, HUMAN));
  const round = ok(await rounds.roundView(review.id, 1));
  assert.ok(round.files.every((f) => f.viewed === false));
  const commit = ok(await reviews.diff(review.id, { commit: sha.slice(0, 8) }));
  assert.ok(commit.files.every((f) => f.viewed === false));
  const cmp = ok(await compareRounds(review.id, { from: 1, to: 2 }));
  assert.ok(cmp.files.every((f) => f.viewed === false));
});

test('the last-viewed marker write is a separate route and is unaffected', async () => {
  // Invariant: markViewed (lastViewedSeq) and setFileViewed (viewedFiles) share no state.
  const { review } = await twoHunks();
  const a = await fileOf(review.id, 'a.js');
  ok(await mark(review.id, 'a.js', a.hunkIds));
  await threads.annotate(review.id, agent('s-author'), { anchor: { kind: 'review' }, kind: 'comment', body: 'hi' });
  ok(await reviews.markViewed(review.id, { seq: 1 }));
  const stored = store.read(review.id);
  assert.equal(stored.lastViewedSeq, 1);
  assert.deepEqual(Object.keys(stored.viewedFiles), ['a.js']);
});
