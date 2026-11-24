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

// Invariant: the overview counts the reviews and threads that need the human and the reviews waiting on an agent, and offers the first needing review.
test('summarises the inbox and starts with the first review that needs you', async () => {
  stubFetch({
    'GET api/inbox': {
      reviews: [
        inboxItem({ ...none, id: 'r-w', title: 'Waiting', turn: 'agent' }),
        inboxItem({ ...none, id: 'r-1', title: 'First', threadStates: { ...states, awaitingHuman: 2 } }),
        inboxItem({ ...none, id: 'r-2', title: 'Second', threadStates: { ...states, verifyResolution: 1 }, project: 'lib', worktree: null }),
        inboxItem({ ...none, id: 'r-3', title: 'Hunks only', hunks: { pending: 2, accepted: 0, rejected: 0 } }),
      ],
    },
  });
  render(<InboxOverview />);
  expect(await screen.findByText('3 reviews need you')).toBeTruthy();
  expect(screen.getByText('3 threads wait on you across 2 reviews · 1 waiting on an agent')).toBeTruthy();
  const start = screen.getByRole('link', { name: 'Start with “First”' });
  expect(parseRoute(start.getAttribute('href')!)).toMatchObject({ project: 'app', worktree: 'feature', review: 'r-1' });
});

// Invariant: with no review needing the human, the overview says so.
test('says nothing needs you when every review is quiet or waiting', async () => {
  stubFetch({ 'GET api/inbox': { reviews: [inboxItem({ ...none, turn: 'agent' })] } });
  render(<InboxOverview />);
  expect(await screen.findByText('Nothing needs you right now')).toBeTruthy();
  expect(screen.queryByRole('link', { name: /Start with/ })).toBeNull();
});
