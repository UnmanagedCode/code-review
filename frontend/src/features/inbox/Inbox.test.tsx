import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { parseRoute } from '@/lib/route';
import { resetResources } from '@/state/resource';
import { FakeEventSource, installFakeEventSource } from '@/test/fakeEventSource';
import { inboxItem, refusal } from '@/test/fixtures';
import { stubFetch } from '@/test/stubFetch';
import { Inbox } from './Inbox';

beforeEach(() => installFakeEventSource());

const states = (over: Partial<ReturnType<typeof inboxItem>['threadStates']>) => ({ awaitingHuman: 0, verifyResolution: 0, unsent: 0, awaitingAgent: 0, ...over });
const quiet = { hunks: { pending: 0, accepted: 1, rejected: 0 }, groupsPending: 0, unsent: false, seenByHuman: true, lastSubmission: null };

// Invariant: rows sit in sections (needs you, waiting on agent, nothing pending), each headed with its count, the served order kept inside; no row says "Your turn".
test('rows are grouped into counted sections in served order, with no Your turn badge', async () => {
  stubFetch({
    'GET api/inbox': {
      reviews: [
        inboxItem({ ...quiet, id: 'r-quiet', title: 'Quiet' }),
        inboxItem({ ...quiet, id: 'r-wait', title: 'Waiting', turn: 'agent', project: 'lib', worktree: null }),
        inboxItem({ ...quiet, id: 'r-a', title: 'First need', threadStates: states({ awaitingHuman: 2 }) }),
        inboxItem({ ...quiet, id: 'r-b', title: 'Second need', unsent: true }),
      ],
    },
  });
  render(<Inbox />);
  await screen.findByText('Quiet');
  const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
  expect(headings).toEqual(['Needs you2', 'Waiting on agent1', 'Nothing pending1']);
  const needs = within(screen.getByRole('region', { name: /Needs you/ }));
  expect(needs.getAllByRole('link').map((l) => l.textContent)).toEqual([expect.stringContaining('First need'), expect.stringContaining('Second need')]);
  expect(within(screen.getByRole('region', { name: /Waiting on agent/ })).getByText('lib · main checkout · range · round 1')).toBeTruthy();
  expect(screen.queryByText(/Your turn/)).toBeNull();
});

// Invariant: a row's chips say what is pending: threads needing you, threads that will be sent, undecided hunks and groups, new activity and the age of the last send.
test('chips name the pending work; the hunk chip is absent when the tally is unknown', async () => {
  stubFetch({
    'GET api/inbox': {
      reviews: [
        inboxItem({ ...quiet, id: 'r-1', title: 'Busy', threadStates: states({ awaitingHuman: 1, verifyResolution: 1, unsent: 3 }), hunks: { pending: 4, accepted: 0, rejected: 0 }, groupsPending: 2, newActivity: true }),
        inboxItem({ ...quiet, id: 'r-2', title: 'Unknown tally', hunks: null, unsent: true }),
        inboxItem({ ...quiet, id: 'r-3', title: 'Sent', turn: 'agent', lastSubmission: { status: 'delivered', at: new Date(Date.now() - 3 * 3_600_000).toISOString() } }),
      ],
    },
  });
  render(<Inbox />);
  const busy = within(await screen.findByRole('link', { name: /Busy/ }));
  for (const chip of ['2 need you', '3 will be sent', '4 hunks undecided', '2 groups to decide', 'new activity']) expect(busy.getByText(chip)).toBeTruthy();
  expect(within(screen.getByRole('link', { name: /Unknown tally/ })).queryByText(/hunks undecided/)).toBeNull();
  const sent = within(screen.getByRole('link', { name: /Sent/ }));
  expect(sent.getByText('sent 3 h ago')).toBeTruthy();
  expect(sent.getByText('No reply yet')).toBeTruthy();
});

// Invariant: counts of one read as singular ("1 hunk undecided", "1 group to decide"), and a send under a minute old reads "sent just now".
test('singular chips and a fresh send', async () => {
  stubFetch({ 'GET api/inbox': { reviews: [inboxItem({ ...quiet, id: 'r-1', title: 'One', turn: 'agent', hunks: { pending: 1, accepted: 0, rejected: 0 }, groupsPending: 1, lastSubmission: { status: 'delivered', at: new Date().toISOString() } })] } });
  render(<Inbox />);
  const row = within(await screen.findByRole('link', { name: /One/ }));
  for (const t of ['1 hunk undecided', '1 group to decide', 'sent just now']) expect(row.getByText(t)).toBeTruthy();
});

// Invariant: the activity line names the agent's last act and where it happened.
test('the activity line says what the agent last did', async () => {
  const at = '2026-01-01T00:00:00Z';
  const thread = (event: 'opened' | 'replied' | 'proposed-resolution' | 'resolved') => ({ kind: 'thread' as const, event, at, thread: { id: 't-1', kind: 'comment' as const, anchor: { kind: 'file' as const, file: 'src/a.ts', round: 1 } } });
  stubFetch({
    'GET api/inbox': {
      reviews: [
        inboxItem({ id: 'r-1', title: 'one', lastAgentAction: thread('replied') }),
        inboxItem({ id: 'r-2', title: 'two', lastAgentAction: thread('proposed-resolution') }),
        inboxItem({ id: 'r-3', title: 'three', lastAgentAction: thread('opened') }),
        inboxItem({ id: 'r-4', title: 'four', lastAgentAction: thread('resolved') }),
        inboxItem({ id: 'r-5', title: 'five', lastAgentAction: { kind: 'update', at: null } }),
      ],
    },
  });
  render(<Inbox />);
  await screen.findByText('Agent replied on a.ts');
  for (const t of ['Agent says a.ts is fixed', 'Agent opened a thread on a.ts', 'Agent resolved a.ts', 'Agent updated the review']) expect(screen.getByText(t)).toBeTruthy();
});

// Invariant: "not opened" is only for reviews the human never saw and whose checkout still exists.
test('not opened is absent on rows whose checkout is gone', async () => {
  stubFetch({ 'GET api/inbox': { reviews: [inboxItem({ id: 'r-1', title: 'Fresh', seenByHuman: false }), inboxItem({ id: 'r-2', title: 'Gone', seenByHuman: false, checkoutGone: true })] } });
  render(<Inbox />);
  await screen.findByText('Fresh');
  expect(screen.getAllByText('not opened')).toHaveLength(1);
  expect(within(screen.getByRole('link', { name: /Gone/ })).queryByText('not opened')).toBeNull();
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
  resetResources(); // the cached empty inbox would otherwise render at once
  let fail = true;
  const net2 = stubFetch({ 'GET api/inbox': () => (fail ? refusal('CONDUCTOR_UNAVAILABLE', 502) : { reviews: [] }) });
  render(<Inbox />);
  expect(await screen.findByText('Something went wrong')).toBeTruthy();
  fail = false;
  await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('No open reviews')).toBeTruthy();
  expect(net2.count('GET api/inbox')).toBe(2);
});
