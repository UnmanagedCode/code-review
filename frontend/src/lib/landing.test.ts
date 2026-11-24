import { expect, test } from 'vitest';
import { inboxItem } from '@/test/fixtures';
import { sessionLanding } from './landing';

const session = { sessionId: 's-1', project: 'app', worktree: 'feature' };
const opts = { knownProject: true, fallback: { project: 'last' }, view: 'inbox' as const };

// Invariant: exactly one open review with the session as recipient or author lands on that review, in its own checkout, with no review-scoped keys.
test('one review of the session opens it, as recipient or as author', () => {
  const a = inboxItem({ id: 'r-a', project: 'lib', worktree: null, recipient: 's-1' });
  const b = inboxItem({ id: 'r-b', recipient: 's-x', author: 's-1' });
  const other = inboxItem({ id: 'r-o', recipient: 's-x' });
  expect(sessionLanding(session, [a, other], opts)).toEqual({ project: 'lib', review: 'r-a' });
  expect(sessionLanding(session, [other, b], opts)).toEqual({ project: 'app', worktree: 'feature', review: 'r-b' });
});

// Invariant: with none or several, the landing is the inbox on the session's own checkout.
test('zero or several reviews of the session land on its checkout, on the tab asked for', () => {
  const mine = (id: string) => inboxItem({ id, recipient: 's-1' });
  expect(sessionLanding(session, [], opts)).toEqual({ project: 'app', worktree: 'feature', view: 'inbox' });
  expect(sessionLanding(session, [mine('r-1'), mine('r-2')], opts)).toEqual({ project: 'app', worktree: 'feature', view: 'inbox' });
  expect(sessionLanding(session, [], { ...opts, view: undefined })).toEqual({ project: 'app', worktree: 'feature' });
});

// Invariant: a session whose project the list lacks lands on the fallback checkout's inbox, but still opens its own single review.
test('an unknown project falls back, yet its single review still opens', () => {
  const unknown = { ...opts, knownProject: false };
  expect(sessionLanding(session, [], unknown)).toEqual({ project: 'last', view: 'inbox' });
  expect(sessionLanding(session, [], { ...unknown, fallback: {} })).toEqual({ view: 'inbox' });
  expect(sessionLanding(session, [inboxItem({ id: 'r-1', recipient: 's-1' })], unknown)).toMatchObject({ review: 'r-1' });
});
