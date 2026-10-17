import { test } from 'node:test';
import assert from 'node:assert/strict';
import { threadsAt, roundThreadView, anchorChain } from '../src/history.js';

// Stored-shape fixtures: an anchor per round, a thread with messages stamped by round.
const pos = (round, startLine, extra = {}) => ({
  file: 'a.js', side: 'new', startLine, endLine: startLine, hunkId: `h${round}`, round, linesHash: `x${startLine}`, drifted: false, ...extra,
});
const stored = (round, startLine, extra) => ({ ...pos(round, startLine, extra), lines: ['x'], ctxBefore: { hash: 'b', n: 1 }, ctxAfter: { hash: 'a', n: 1 } });
let seq = 0;
const msg = (round, author = { kind: 'session', sessionId: 's', role: 'author' }) => ({ id: `m${++seq}`, seq, author, body: 'b', at: '', round, proposeResolve: false });
const thread = (over = {}) => ({
  id: 't1', kind: 'comment', severity: null, status: 'open', disposition: null, resolution: null, resolveProposed: false,
  statusSeq: 1, openedBy: { kind: 'human' }, humanReadSeq: 0, createdAt: '', messages: [msg(1)], pastAnchors: [], anchor: stored(1, 5),
  ...over,
});
const at = (threads, n) => threadsAt({ threads }, n);
const only = (res) => { assert.equal(res.threads.length + res.unplaced.length, 1); return res.threads[0] ?? res.unplaced[0]; };

test('a thread opened in a later round is absent from earlier rounds and present from its own', () => {
  const t = thread({ messages: [msg(2)], anchor: stored(2, 7) });
  assert.deepEqual(at([t], 1), { threads: [], unplaced: [] });
  assert.equal(at([t], 2).threads.length, 1);
});

test('messages of later rounds are cut and counted in laterMessages', () => {
  const t = thread({ messages: [msg(1), msg(1), msg(2), msg(3)], pastAnchors: [pos(1, 5), pos(2, 6)], anchor: stored(3, 7) });
  const r1 = only(at([t], 1));
  assert.deepEqual(r1.messages, t.messages.slice(0, 2));
  assert.equal(r1.laterMessages, 2);
  assert.equal(only(at([t], 2)).laterMessages, 1);
  assert.equal(only(at([t], 3)).laterMessages, 0);
});

test('the anchor of round n is the latest recorded position at or before n', () => {
  // Positions recorded for rounds 1, 2 and 4: round 3, with none of its own, resolves to round 2's.
  const t = thread({ pastAnchors: [pos(1, 5), pos(2, 6)], anchor: stored(4, 9) });
  assert.equal(only(at([t], 1)).anchor.startLine, 5);
  assert.equal(only(at([t], 2)).anchor.startLine, 6);
  assert.equal(only(at([t], 3)).anchor.startLine, 6);
  assert.equal(only(at([t], 4)).anchor.startLine, 9);
  assert.equal(only(at([t], 4)).anchor.round, 4);
});

test('drift is per round: each round shows the drifted flag its own anchor had', () => {
  const t = thread({ pastAnchors: [pos(1, 5), pos(2, 6, { drifted: true })], anchor: stored(3, 7) });
  assert.deepEqual([1, 2, 3].map((n) => only(at([t], n)).anchor.drifted), [false, true, false]);
});

test('the file of round n is the path the thread had then (renamed later)', () => {
  const t = thread({ pastAnchors: [pos(1, 5, { file: 'old.js' })], anchor: stored(2, 5, { file: 'new.js' }) });
  assert.equal(only(at([t], 1)).anchor.file, 'old.js');
  assert.equal(only(at([t], 2)).anchor.file, 'new.js');
});

test('an outdated thread is outdated only after its last located round, at that round\'s anchor', () => {
  const t = thread({ status: 'outdated', pastAnchors: [pos(1, 5)], anchor: stored(2, 6) });
  const r2 = only(at([t], 2));
  assert.equal(r2.status, 'open');
  assert.equal(r2.anchor.startLine, 6);
  for (const n of [3, 4]) {
    const later = only(at([t], n));
    assert.equal(later.status, 'outdated');
    assert.deepEqual(later.anchor, pos(2, 6));
  }
});

test('before going outdated a thread shows resolved when it carries a resolution, open otherwise', () => {
  const resolved = thread({ status: 'outdated', resolution: { by: { kind: 'human' }, seq: 2 }, anchor: stored(1, 5) });
  assert.equal(only(at([resolved], 1)).status, 'resolved');
  const open = thread({ status: 'outdated', resolution: null, anchor: stored(1, 5) });
  assert.equal(only(at([open], 1)).status, 'open');
});

test('a thread not outdated keeps its current status in every round', () => {
  const t = thread({ status: 'resolved', resolution: { by: { kind: 'human' }, seq: 9 }, pastAnchors: [pos(1, 5)], anchor: stored(2, 5) });
  assert.equal(only(at([t], 1)).status, 'resolved');
});

test('a thread with no recorded position for round n is unplaced, at its earliest known anchor, flagged positionUnknown', () => {
  // Anchored before positions were kept: only its latest anchor (round 3) is known, but it was opened in round 1.
  const legacy = thread({ messages: [msg(1), msg(3)], pastAnchors: [], anchor: stored(3, 8) });
  for (const n of [1, 2]) {
    const res = at([legacy], n);
    assert.equal(res.threads.length, 0);
    assert.equal(res.unplaced[0].positionUnknown, true);
    assert.deepEqual(res.unplaced[0].anchor, pos(3, 8));
  }
  const placed = at([legacy], 3);
  assert.equal(placed.unplaced.length, 0);
  assert.equal(placed.threads[0].positionUnknown, false);
});

test('an unplaced legacy thread that is outdated now shows its status before outdating', () => {
  const legacy = thread({ status: 'outdated', resolution: null, messages: [msg(1)], anchor: stored(2, 8) });
  assert.equal(at([legacy], 1).unplaced[0].status, 'open');
  assert.equal(at([legacy], 3).threads[0].status, 'outdated');
});

test('a round view has no unread messages and no proposed resolution, and the stored thread is not modified', () => {
  const t = thread({ resolveProposed: true, humanReadSeq: 0, messages: [msg(1), msg(1)] });
  const before = structuredClone(t);
  const view = roundThreadView(only(at([t], 1)));
  assert.equal(view.unread, 0);
  assert.equal(view.resolveProposed, false);
  assert.equal(view.laterMessages, 0);
  assert.equal(view.positionUnknown, false);
  assert.deepEqual(t, before);
});

test('the round view of a thread shows the positional anchor only', () => {
  const view = roundThreadView(only(at([thread()], 1)));
  assert.deepEqual(view.anchor, pos(1, 5));
});

test('the anchor chain lists earlier positions oldest first, then the current anchor without its lines', () => {
  assert.deepEqual(anchorChain(thread({ pastAnchors: [pos(1, 5), pos(2, 6)], anchor: stored(3, 7) })), [pos(1, 5), pos(2, 6), pos(3, 7)]);
});
