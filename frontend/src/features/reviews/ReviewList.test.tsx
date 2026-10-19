import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { FakeEventSource, installFakeEventSource } from '@/test/fakeEventSource';
import { parseRoute } from '@/lib/route';
import { review } from '@/test/fixtures';
import { stubFetch } from '@/test/stubFetch';
import { ReviewList } from './ReviewList';

beforeEach(() => installFakeEventSource());
const queries = (net: ReturnType<typeof stubFetch>) => net.calls.filter((c) => c.url.pathname === '/api/reviews').map((c) => c.url.search);

test('queries worktree= for the main checkout, the name for a worktree, and omits it for all checkouts', async () => {
  const net = stubFetch({ 'GET api/reviews': { reviews: [] } });
  const user = userEvent.setup();
  const { unmount } = render(<ReviewList project="app" worktree={undefined} />);
  await screen.findByText('No reviews yet');
  expect(queries(net).at(-1)).toBe('?project=app&worktree=&status=open');
  await user.selectOptions(screen.getByLabelText('Scope'), 'project');
  await screen.findByText('No reviews yet');
  expect(queries(net).at(-1)).toBe('?project=app&status=open');
  unmount();
  const net2 = stubFetch({ 'GET api/reviews': { reviews: [] } });
  render(<ReviewList project="app" worktree="feature" />);
  await screen.findByText('No reviews yet');
  expect(queries(net2).at(-1)).toBe('?project=app&worktree=feature&status=open');
});

test('unread, blockers, HEAD moved and new badges reflect the summary', async () => {
  stubFetch({ 'GET api/reviews': { reviews: [review({ unread: 3, mergeBlockers: 2, headMoved: true, seenByHuman: false, title: 'My review' })] } });
  render(<ReviewList project="app" worktree="feature" />);
  const row = (await screen.findByText('My review')).closest('a')!;
  const r = within(row);
  expect(r.getByLabelText('3 unread')).toBeTruthy();
  expect(r.getByText('2 blocking')).toBeTruthy();
  expect(r.getByText('HEAD moved')).toBeTruthy();
  expect(r.getByText('new')).toBeTruthy();
  expect(row.getAttribute('href')).toContain('review=r-1');
});

test('any SSE event reloads the visible list after the debounce', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const net = stubFetch({ 'GET api/reviews': { reviews: [] } });
  render(<ReviewList project="app" worktree="feature" />);
  await vi.waitFor(() => expect(net.count('GET api/reviews')).toBe(1));
  act(() => FakeEventSource.last!.emit({ id: 'r-other', rev: 1 }));
  expect(net.count('GET api/reviews')).toBe(1);
  await act(() => vi.advanceTimersByTimeAsync(300));
  expect(net.count('GET api/reviews')).toBe(2);
});

test('opening a review from the list drops every review-scoped key of the one left, round included', async () => {
  history.replaceState(null, '', '?project=app&worktree=feature&review=r-1&round=1&file=a.js&commit=abc1234&view=threads');
  stubFetch({ 'GET api/reviews': { reviews: [review({ id: 'r-2', title: 'Other' })] } });
  render(<ReviewList project="app" worktree="feature" />);
  await userEvent.setup().click(await screen.findByRole('link', { name: /Other/ }));
  expect(parseRoute(location.search)).toEqual({ project: 'app', worktree: 'feature', review: 'r-2' });
});

test('New review follows the reviews, outside the list, and opens the New review dialog route', async () => {
  history.replaceState(null, '', '?project=app&worktree=feature');
  stubFetch({ 'GET api/reviews': { reviews: [review({ id: 'r-1', title: 'One' }), review({ id: 'r-2', title: 'Two' })] } });
  render(<ReviewList project="app" worktree="feature" />);
  await screen.findByText('Two');
  const button = within(screen.getByRole('region', { name: 'Reviews' })).getByRole('button', { name: 'New review' });
  expect(screen.getAllByRole('listitem').at(-1)!.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByRole('list').contains(button)).toBe(false);
  expect(screen.queryByRole('heading', { name: 'Reviews' })).toBeNull();
  await userEvent.setup().click(button);
  expect(parseRoute(location.search)).toMatchObject({ project: 'app', worktree: 'feature', view: 'new' });
});

test('New review follows the empty state', async () => {
  stubFetch({ 'GET api/reviews': { reviews: [] } });
  render(<ReviewList project="app" worktree="feature" />);
  await screen.findByText('No reviews yet');
  expect(screen.getByText('No reviews yet').compareDocumentPosition(screen.getByRole('button', { name: 'New review' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
