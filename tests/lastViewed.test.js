import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { world, HUMAN, agent } from './_world.js';
import * as reviews from '../src/reviews.js';
import * as threads from '../src/threads.js';
import * as store from '../src/store.js';
import * as inbox from '../src/inbox.js';

let w;
beforeEach(async () => { w = await world(); w.session('s-author', { worktree: 'feature' }); });
afterEach(() => w.cleanup());

const ok = (res) => { assert.equal(res.ok, true, JSON.stringify(res)); return res; };
const codeOf = (res) => { assert.equal(res.ok, false, 'expected a refusal'); return res.code; };

async function open() {
  w.addWorktree().commit({ 'b.js': 'x\n' });
  const { review } = ok(await reviews.openReview({ project: 'app', worktree: 'feature', recipient: 's-author' }, HUMAN));
  for (let i = 0; i < 3; i++) ok(await threads.annotate(review.id, agent('s-author'), { anchor: { kind: 'review' }, kind: 'comment', body: `n${i}` }));
  return review.id;
}
const marker = (id) => store.read(id).lastViewedSeq;

test('viewed never moves the marker backwards and clamps to the review seq', async () => {
  // Invariant: lastViewedSeq = max(old, min(seq, review.seq)).
  const id = await open();
  assert.equal(marker(id), 0);
  assert.equal(ok(await reviews.markViewed(id, { seq: 2 })).review.lastViewedSeq, 2);
  ok(await reviews.markViewed(id, { seq: 1 }));
  assert.equal(marker(id), 2);
  ok(await reviews.markViewed(id, { seq: 999 }));
  assert.equal(marker(id), store.read(id).seq);
});

test('viewed is not activity and an unchanged marker writes nothing', async () => {
  // Invariant: no seq bump, no lastActivityAt change, no inbox reorder; an unchanged marker leaves rev alone and emits no change.
  const id = await open();
  ok(await reviews.markViewed(id, { seq: 1 }));
  const before = store.read(id);
  const seen = [];
  const on = (c) => seen.push(c);
  store.changes.on('change', on);
  ok(await reviews.markViewed(id, { seq: 1 }));
  ok(await reviews.markViewed(id, { seq: 0 }));
  store.changes.off('change', on);
  assert.deepEqual(seen, []);
  assert.equal(store.read(id).rev, before.rev);
  ok(await reviews.markViewed(id, { seq: 3 }));
  const after = store.read(id);
  assert.equal(after.seq, before.seq);
  assert.equal(after.lastActivityAt, before.lastActivityAt);
  assert.equal(ok(await inbox.listInbox()).reviews[0].lastActivityAt, before.lastActivityAt);
});

test('viewed is allowed on a closed review', async () => {
  // Invariant: the marker is not a review write, so it is not gated by assertOpen.
  const id = await open();
  ok(await reviews.patchReview(id, { status: 'closed' }));
  assert.equal(ok(await reviews.markViewed(id, { seq: 2 })).review.lastViewedSeq, 2);
});

test('viewed refuses a bad seq and an unknown review', async () => {
  // Invariant: seq must be a non-negative integer (INVALID_ARGUMENT); an unknown id is REVIEW_UNKNOWN.
  const id = await open();
  for (const seq of [-1, 1.5, '2', undefined, null]) assert.equal(codeOf(await reviews.markViewed(id, { seq })), 'INVALID_ARGUMENT', String(seq));
  assert.equal(codeOf(await reviews.markViewed(id, undefined)), 'INVALID_ARGUMENT');
  assert.equal(codeOf(await reviews.markViewed('r-0000000000', { seq: 1 })), 'REVIEW_UNKNOWN');
});
