import { describe, expect, test } from 'vitest';
import { inboxItem } from '@/test/fixtures';
import { bucketOf, groupInbox, needsYouOf } from './inbox';

const states = (over: Partial<ReturnType<typeof inboxItem>['threadStates']>) => ({ awaitingHuman: 0, verifyResolution: 0, unsent: 0, awaitingAgent: 0, ...over });
const quiet = { hunks: { pending: 0, accepted: 2, rejected: 0 }, groupsPending: 0, unsent: false, seenByHuman: true, lastSubmission: null, turn: 'human' as const };

// Invariant: each trigger alone puts a human-turn review in Needs you; with none of them it is Nothing pending.
describe('bucketOf', () => {
  test('a quiet review has nothing pending', () => expect(bucketOf(inboxItem(quiet))).toBe('nothing'));
  test.each([
    ['a thread awaiting the human', { threadStates: states({ awaitingHuman: 1 }) }],
    ['a thread to verify', { threadStates: states({ verifyResolution: 1 }) }],
    ['an undecided hunk', { hunks: { pending: 1, accepted: 0, rejected: 0 } }],
    ['an undecided group', { groupsPending: 1 }],
    ['unsent work', { unsent: true }],
    ['a review never opened', { seenByHuman: false }],
    ['a pending submission', { lastSubmission: { status: 'pending' as const, at: 'x' } }],
    ['a failed submission', { lastSubmission: { status: 'failed' as const, at: 'x' } }],
  ])('%s needs you', (_n, over) => expect(bucketOf(inboxItem({ ...quiet, ...over }))).toBe('needs-you'));
  test('a hunk tally of null (no stored ids) is not a trigger', () => expect(bucketOf(inboxItem({ ...quiet, hunks: null }))).toBe('nothing'));
  test('threads waiting on the agent or about to be sent do not need you by themselves', () => {
    expect(bucketOf(inboxItem({ ...quiet, threadStates: states({ awaitingAgent: 3, unsent: 1 }) }))).toBe('nothing');
  });
  test('the agent’s turn is waiting, whatever else is open', () => {
    expect(bucketOf(inboxItem({ ...quiet, turn: 'agent', groupsPending: 2, threadStates: states({ awaitingHuman: 1 }) }))).toBe('waiting');
  });
});

// Invariant: needsYouOf counts the two human-move states only.
test('needsYouOf sums awaiting-human and verify-resolution', () => {
  expect(needsYouOf(inboxItem({ threadStates: states({ awaitingHuman: 2, verifyResolution: 1, unsent: 5, awaitingAgent: 4 }) }))).toBe(3);
});

// Invariant: sections come in the order needs-you, waiting, nothing; the served order holds inside each; empty sections are omitted.
test('groupInbox orders the sections and keeps the served order within them', () => {
  const a = inboxItem({ ...quiet, id: 'a' });
  const b = inboxItem({ ...quiet, id: 'b', turn: 'agent' });
  const c = inboxItem({ ...quiet, id: 'c', unsent: true });
  const d = inboxItem({ ...quiet, id: 'd', unsent: true });
  expect(groupInbox([a, b, c, d]).map((s) => [s.bucket, s.items.map((i) => i.id)])).toEqual([['needs-you', ['c', 'd']], ['waiting', ['b']], ['nothing', ['a']]]);
  expect(groupInbox([b]).map((s) => s.bucket)).toEqual(['waiting']);
  expect(groupInbox([])).toEqual([]);
});
