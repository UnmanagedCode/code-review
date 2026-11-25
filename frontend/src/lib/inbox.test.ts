import { expect, test } from 'vitest';
import { inboxItem } from '@/test/fixtures';
import { groupInbox, needsYouOf } from './inbox';

// Invariant: needsYouOf counts the two human-move states only.
test('needsYouOf sums awaiting-human and verify-resolution', () => {
  expect(needsYouOf(inboxItem({ threadStates: { awaitingHuman: 2, verifyResolution: 1, unsent: 5, awaitingAgent: 4 } }))).toBe(3);
});

// Invariant: groupInbox sections rows by their served bucket, in order of first appearance, keeping the served row order inside each; there are no empty sections.
test('groupInbox groups by the served bucket and keeps the served order', () => {
  const rows = [
    inboxItem({ id: 'a', bucket: 'needs-you' }), inboxItem({ id: 'b', bucket: 'waiting' }), inboxItem({ id: 'c', bucket: 'needs-you' }),
    inboxItem({ id: 'd', bucket: 'stale' }), inboxItem({ id: 'e', bucket: 'nothing' }),
  ];
  expect(groupInbox(rows).map((s) => [s.bucket, s.items.map((i) => i.id)])).toEqual([['needs-you', ['a', 'c']], ['waiting', ['b']], ['stale', ['d']], ['nothing', ['e']]]);
  expect(groupInbox([inboxItem({ bucket: 'stale' })]).map((s) => s.bucket)).toEqual(['stale']);
  expect(groupInbox([])).toEqual([]);
});
