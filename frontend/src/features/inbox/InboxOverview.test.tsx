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

// Invariant: the Start-with button skips a review whose checkout is gone (a dead end), still counting it as needing you; with only gone ones there is no button.
test('Start with skips checkout-gone reviews', async () => {
  stubFetch({
    'GET api/inbox': {
      reviews: [
        inboxItem({ ...none, id: 'r-gone', title: 'Gone', checkoutGone: true, threadStates: { ...states, awaitingHuman: 1 } }),
        inboxItem({ ...none, id: 'r-ok', title: 'Alive', threadStates: { ...states, awaitingHuman: 1 } }),
      ],
    },
  });
  const { unmount } = render(<InboxOverview />);
  expect(await screen.findByText('2 reviews need you')).toBeTruthy();
  expect(parseRoute(screen.getByRole('link', { name: 'Start with “Alive”' }).getAttribute('href')!).review).toBe('r-ok');
  unmount();
});

test('Start with is absent when every review that needs you has a gone checkout', async () => {
  const { resetResources } = await import('@/state/resource');
  resetResources();
  stubFetch({ 'GET api/inbox': { reviews: [inboxItem({ ...none, id: 'r-gone', title: 'Gone', checkoutGone: true, threadStates: { ...states, awaitingHuman: 1 } })] } });
  render(<InboxOverview />);
  expect(await screen.findByText('1 review needs you')).toBeTruthy();
  expect(screen.queryByRole('link', { name: /Start with/ })).toBeNull();
});
