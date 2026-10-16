import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test } from 'vitest';
import { installFakeEventSource } from '@/test/fakeEventSource';
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
