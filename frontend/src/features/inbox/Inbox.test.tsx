import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { parseRoute } from '@/lib/route';
import { FakeEventSource, installFakeEventSource } from '@/test/fakeEventSource';
import { inboxItem, refusal } from '@/test/fixtures';
import { stubFetch } from '@/test/stubFetch';
import { Inbox } from './Inbox';

beforeEach(() => installFakeEventSource());

// Invariant: rows keep the served order and show project · checkout, whose turn it is and the unread count.
test('rows render in served order with their checkout, turn and unread badge', async () => {
  stubFetch({
    'GET api/inbox': {
      reviews: [
        inboxItem({ id: 'r-2', title: 'Newest', project: 'lib', worktree: null, turn: 'agent' }),
        inboxItem({ id: 'r-1', title: '', label: 'main…feature', unread: 2, seenByHuman: false }),
      ],
    },
  });
  render(<Inbox />);
  const links = await screen.findAllByRole('link');
  expect(links).toHaveLength(2);
  expect(within(links[0]).getByText('Newest')).toBeTruthy();
  expect(within(links[1]).getByText('main…feature')).toBeTruthy();
  expect(within(links[0]).getByText('lib · main checkout')).toBeTruthy();
  expect(within(links[0]).getByText('Waiting on agent')).toBeTruthy();
  expect(within(links[1]).getByText('app · feature')).toBeTruthy();
  expect(within(links[1]).getByText('Your turn')).toBeTruthy();
  expect(within(links[1]).getByLabelText('2 unread')).toBeTruthy();
});

// Invariant: a row opens the review in its own checkout and drops view=inbox with every other review-scoped key.
test('a row links to its own project, worktree and review, with no view', async () => {
  history.replaceState(null, '', '?project=other&view=inbox');
  stubFetch({ 'GET api/inbox': { reviews: [inboxItem({ id: 'r-1', title: 'Mine' }), inboxItem({ id: 'r-9', title: 'Main', worktree: null })] } });
  render(<Inbox />);
  expect(parseRoute((await screen.findByRole('link', { name: /Main/ })).getAttribute('href')!)).toEqual({ project: 'app', review: 'r-9' });
  await userEvent.setup().click(screen.getByRole('link', { name: /Mine/ }));
  expect(parseRoute(location.search)).toEqual({ project: 'app', worktree: 'feature', review: 'r-1' });
});

// Invariant: Close shows only on rows whose checkout is gone, PATCHes status closed, then refetches the inbox.
test('Close shows only on gone rows, closes the review and refetches', async () => {
  const net = stubFetch({
    'GET api/inbox': { reviews: [inboxItem({ id: 'r-1', title: 'Gone', checkoutGone: true }), inboxItem({ id: 'r-2', title: 'Here' }), inboxItem({ id: 'r-3', title: 'Unknown', checkoutGone: null })] },
    'PATCH api/reviews/r-1': { review: {} },
  });
  render(<Inbox />);
  await screen.findByText('Gone');
  expect(screen.getAllByRole('button', { name: /^Close review/ }).map((b) => b.getAttribute('aria-label'))).toEqual(['Close review Gone']);
  expect(screen.getAllByText('checkout gone')).toHaveLength(1);
  await userEvent.setup().click(screen.getByRole('button', { name: 'Close review Gone' }));
  await vi.waitFor(() => expect(net.count('GET api/inbox')).toBe(2));
  expect(net.calls.find((c) => c.method === 'PATCH')?.body).toEqual({ status: 'closed' });
});

// Invariant: a refused Close toasts and does not pretend it worked.
test('a refused Close toasts the refusal', async () => {
  const { toast } = await import('sonner');
  const error = vi.spyOn(toast, 'error').mockImplementation(() => '');
  const net = stubFetch({ 'GET api/inbox': { reviews: [inboxItem({ title: 'Gone', checkoutGone: true })] }, 'PATCH api/reviews/r-1': refusal('REVIEW_UNKNOWN', 404) });
  render(<Inbox />);
  await userEvent.setup().click(await screen.findByRole('button', { name: 'Close review Gone' }));
  await vi.waitFor(() => expect(error).toHaveBeenCalledWith('Review not found (it may have been deleted)'));
  expect(net.count('GET api/inbox')).toBe(1);
});

// Invariant: any SSE review event refetches the inbox after the debounce.
test('an SSE review event refetches the inbox', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const net = stubFetch({ 'GET api/inbox': { reviews: [] } });
  render(<Inbox />);
  await vi.waitFor(() => expect(net.count('GET api/inbox')).toBe(1));
  act(() => FakeEventSource.last!.emit({ id: 'r-any', rev: 3 }));
  await act(() => vi.advanceTimersByTimeAsync(300));
  expect(net.count('GET api/inbox')).toBe(2);
});

// Invariant: an empty inbox says so; a failed load shows the error with a Retry that refetches.
test('empty and error states', async () => {
  stubFetch({ 'GET api/inbox': { reviews: [] } });
  const { unmount } = render(<Inbox />);
  expect(await screen.findByText('No open reviews')).toBeTruthy();
  unmount();
  let fail = true;
  const net2 = stubFetch({ 'GET api/inbox': () => (fail ? refusal('CONDUCTOR_UNAVAILABLE', 502) : { reviews: [] }) });
  render(<Inbox />);
  expect(await screen.findByText('Something went wrong')).toBeTruthy();
  fail = false;
  await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('No open reviews')).toBeTruthy();
  expect(net2.count('GET api/inbox')).toBe(2);
});
