import { render, screen } from '@testing-library/react';
import { beforeEach, expect, test } from 'vitest';
import { parseRoute } from '@/lib/route';
import { installFakeEventSource } from '@/test/fakeEventSource';
import { inboxItem } from '@/test/fixtures';
import { stubFetch } from '@/test/stubFetch';
import { InboxOverview } from './InboxOverview';

beforeEach(() => installFakeEventSource());
const none = { hunks: { pending: 0, accepted: 1, rejected: 0 }, groupsPending: 0, unsent: false, seenByHuman: true, lastSubmission: null };
const states = { awaitingHuman: 0, verifyResolution: 0, unsent: 0, awaitingAgent: 0 };

const needs = { bucket: 'needs-you' as const };

// Invariant: the overview counts the reviews and threads that need the human and the reviews waiting on an agent, and starts with the first served Needs-you row.
test('summarises the inbox and starts with the first review that needs you', async () => {
  stubFetch({
    'GET api/inbox': {
      reviews: [
        inboxItem({ ...none, ...needs, id: 'r-1', title: 'First', threadStates: { ...states, awaitingHuman: 2 } }),
        inboxItem({ ...none, ...needs, id: 'r-2', title: 'Second', threadStates: { ...states, verifyResolution: 1 }, project: 'lib', worktree: null }),
        inboxItem({ ...none, ...needs, id: 'r-3', title: 'Hunks only', hunks: { pending: 2, accepted: 0, rejected: 0 } }),
        inboxItem({ ...none, id: 'r-w', title: 'Waiting', turn: 'agent', bucket: 'waiting' }),
        inboxItem({ ...none, id: 'r-s', title: 'Stale', bucket: 'stale', staleReasons: ['idle'] }),
      ],
    },
  });
  render(<InboxOverview />);
  expect(await screen.findByText('3 reviews need you')).toBeTruthy();
  expect(screen.getByText('3 threads wait on you across 2 reviews · 1 waiting on an agent')).toBeTruthy();
  const start = screen.getByRole('link', { name: 'Start with “First”' });
  expect(parseRoute(start.getAttribute('href')!)).toMatchObject({ project: 'app', worktree: 'feature', review: 'r-1' });
});

// Invariant: stale and waiting reviews never count as needing the human, so with only those the overview says nothing needs you and offers no start.
test('says nothing needs you when every review is quiet, waiting or stale', async () => {
  stubFetch({ 'GET api/inbox': { reviews: [inboxItem({ ...none, id: 'r-w', turn: 'agent', bucket: 'waiting' }), inboxItem({ ...none, id: 'r-s', bucket: 'stale', staleReasons: ['checkout-gone'], checkoutGone: true })] } });
  render(<InboxOverview />);
  expect(await screen.findByText('Nothing needs you right now')).toBeTruthy();
  expect(screen.getByText('1 review waiting on an agent')).toBeTruthy();
  expect(screen.queryByRole('link', { name: /Start with/ })).toBeNull();
});
