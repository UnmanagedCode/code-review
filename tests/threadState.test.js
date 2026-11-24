import { test } from 'node:test';
import assert from 'node:assert/strict';
import { threadState, stateCounts, unsentActivity, lastDeliveredRoundSeq, NEEDS_YOU } from '../src/threadState.js';

const HUMAN = { kind: 'human' };
const AGENT = { kind: 'session', sessionId: 's-a', role: 'author' };
const msg = (seq, author) => ({ id: `m${seq}`, seq, author, body: 'x', proposeResolve: false });
const thread = (messages, over = {}) => ({ id: 't1', status: 'open', resolveProposed: false, statusSeq: messages[0].seq, messages, ...over });
const sub = (seq, status, kind = 'round') => ({ id: `s${seq}`, seq, status, kind });
const review = (submissions = [], threads = []) => ({ submissions, threads, humanSeq: 0 });

test('an agent acting last leaves the thread awaiting the human; a proposal asks the human to verify', () => {
  // Invariant: agent act seq > human act seq gives awaiting-human, or verify-resolution when resolveProposed.
  const r = review();
  assert.equal(threadState(r, thread([msg(1, AGENT)])), 'awaiting-human');
  assert.equal(threadState(r, thread([msg(1, HUMAN), msg(2, AGENT)])), 'awaiting-human');
  assert.equal(threadState(r, thread([msg(1, HUMAN), msg(2, AGENT)], { resolveProposed: true })), 'verify-resolution');
  assert.deepEqual(NEEDS_YOU, ['awaiting-human', 'verify-resolution']);
});

test('the human acting last is unsent until a delivered round composed at or after that act', () => {
  // Invariant: human act seq <= the newest delivered round submission's seq flips unsent to awaiting-agent, and only then.
  const t = thread([msg(3, HUMAN)]);
  assert.equal(threadState(review([]), t), 'unsent');
  assert.equal(threadState(review([sub(2, 'delivered')]), t), 'unsent');
  assert.equal(threadState(review([sub(3, 'delivered')]), t), 'awaiting-agent');
  assert.equal(threadState(review([sub(9, 'delivered')]), t), 'awaiting-agent');
});

test('a pending, failed, superseded or guide submission never makes a thread awaiting-agent', () => {
  // Invariant: only a delivered submission of kind round counts as sent ("Will be sent" until then).
  const t = thread([msg(3, HUMAN)]);
  for (const s of [sub(9, 'pending'), sub(9, 'failed'), sub(9, 'superseded'), sub(9, 'delivered', 'guide')]) {
    assert.equal(threadState(review([s]), t), 'unsent', `${s.status}/${s.kind}`);
  }
  assert.equal(lastDeliveredRoundSeq(review([sub(9, 'delivered', 'guide')])), 0);
});

test('a human reopen, a status change with no message, counts as the human acting', () => {
  // Invariant: a statusSeq that no message carries is a human act, so an agent reply before it no longer leaves the thread awaiting-human.
  const t = thread([msg(1, HUMAN), msg(2, AGENT)], { statusSeq: 5 });
  assert.equal(threadState(review(), t), 'unsent');
  assert.equal(threadState(review([sub(5, 'delivered')]), t), 'awaiting-agent');
});

test('a human reply after an agent proposal is unsent, though resolveProposed stays set', () => {
  // Invariant: act ordering, not the proposal flag, decides: the human answered, so the agent has the move.
  const t = thread([msg(1, HUMAN), msg(2, AGENT), msg(3, HUMAN)], { resolveProposed: true });
  assert.equal(threadState(review(), t), 'unsent');
});

test('resolved and outdated threads have no state', () => {
  // Invariant: state is null unless the thread is open.
  for (const status of ['resolved', 'outdated']) assert.equal(threadState(review(), thread([msg(1, AGENT)], { status })), null);
});

test('stateCounts partitions the open threads and unsentActivity follows the first-submission rule', () => {
  // Invariant: the four counts sum to the open threads; the first round is always sendable, later ones need new human activity.
  const threads = [
    thread([msg(1, AGENT)]),
    thread([msg(2, HUMAN), msg(3, AGENT)], { resolveProposed: true }),
    thread([msg(4, HUMAN)]),
    thread([msg(5, HUMAN)], { status: 'resolved' }),
  ];
  const r = { ...review([sub(10, 'delivered')], threads), humanSeq: 4 };
  assert.deepEqual(stateCounts(r), { awaitingHuman: 1, verifyResolution: 1, unsent: 0, awaitingAgent: 1 });
  assert.equal(unsentActivity({ ...r, humanSeq: 4 }), false);
  assert.equal(unsentActivity({ ...r, humanSeq: 11 }), true);
  assert.equal(unsentActivity(review()), true);
});
