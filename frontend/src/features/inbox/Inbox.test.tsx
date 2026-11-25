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
const needsYou = { bucket: 'needs-you' as const };

// Invariant: rows sit in the sections the server gave them, in served order, each headed with its count; no row says "Your turn".
test('rows are grouped into counted sections in served order, with no Your turn badge', async () => {
  stubFetch({
    'GET api/inbox': {
      reviews: [
        inboxItem({ ...quiet, ...needsYou, id: 'r-a', title: 'First need', reasons: ['threads'], threadStates: states({ awaitingHuman: 2 }) }),
        inboxItem({ ...quiet, ...needsYou, id: 'r-b', title: 'Second need', reasons: ['never-sent'], unsent: true }),
        inboxItem({ ...quiet, id: 'r-wait', title: 'Waiting', turn: 'agent', bucket: 'waiting', project: 'lib', worktree: null }),
        inboxItem({ ...quiet, id: 'r-quiet', title: 'Quiet' }),
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

// Invariant: a row's chips follow its reasons in the served order, then say will-be-sent, new activity and the age of the last send.
test('chips name the reasons in served order', async () => {
  stubFetch({
    'GET api/inbox': {
      reviews: [
        inboxItem({ ...quiet, ...needsYou, id: 'r-1', title: 'Busy', reasons: ['threads', 'hunks', 'groups'], threadStates: states({ awaitingHuman: 1, verifyResolution: 1, unsent: 3 }), hunks: { pending: 4, accepted: 0, rejected: 0 }, groupsPending: 2, newActivity: true }),
        inboxItem({ ...quiet, id: 'r-3', title: 'Sent', turn: 'agent', bucket: 'waiting', lastSubmission: { status: 'delivered', at: new Date(Date.now() - 3 * 3_600_000).toISOString() } }),
      ],
    },
  });
  render(<Inbox />);
  const busy = within(await screen.findByRole('link', { name: /Busy/ }));
  const chips = ['2 need you', '4 hunks undecided', '2 groups to decide', '3 will be sent', 'new activity'];
  for (const chip of chips) expect(busy.getByText(chip)).toBeTruthy();
  const order = chips.map((c) => busy.getByText(c));
  for (let i = 1; i < order.length; i++) expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const sent = within(screen.getByRole('link', { name: /Sent/ }));
  expect(sent.getByText('sent 3 h ago')).toBeTruthy();
  expect(sent.getByText('No reply yet')).toBeTruthy();
});

// Invariant: every code of a Needs-you row's reasons shows a chip, and a legacy row (no stored hunk tally) says why it is listed.
test('every Needs-you row states a reason, including legacy rows', async () => {
  const codes = [
    ['threads', { threadStates: states({ awaitingHuman: 1 }) }, '1 need you'],
    ['send-failed', {}, 'send failed'],
    ['send-pending', {}, 'send unconfirmed'],
    ['hunks', { hunks: { pending: 1, accepted: 0, rejected: 0 } }, '1 hunk undecided'],
    ['groups', { groupsPending: 1 }, '1 group to decide'],
    ['not-opened', { seenByHuman: false }, 'not opened'],
    ['unsent', {}, 'unsent changes'],
    ['never-sent', { hunks: null }, 'never sent'],
  ] as const;
  const unsentThreads = inboxItem({ ...quiet, ...needsYou, id: 'r-u', title: 'Unsent threads', reasons: ['unsent'], unsent: true, threadStates: states({ unsent: 2 }) });
  stubFetch({ 'GET api/inbox': { reviews: [...codes.map(([code, over]) => inboxItem({ ...quiet, ...needsYou, ...over, id: `r-${code}`, title: code, reasons: [code] })), unsentThreads] } });
  render(<Inbox />);
  await screen.findByRole('link', { name: /never-sent/ });
  for (const [code, , chip] of codes) expect(within(screen.getByRole('link', { name: new RegExp(`^${code}`) })).getByText(chip)).toBeTruthy();
  expect(within(screen.getByRole('link', { name: /Unsent threads/ })).getByText('2 will be sent')).toBeTruthy();
  expect(within(screen.getByRole('link', { name: /Unsent threads/ })).queryByText('unsent changes')).toBeNull();
});

// Invariant: counts of one read as singular ("1 hunk undecided", "1 group to decide"), and a send under a minute old reads "sent just now".
test('singular chips and a fresh send', async () => {
  stubFetch({ 'GET api/inbox': { reviews: [inboxItem({ ...quiet, ...needsYou, id: 'r-1', title: 'One', turn: 'agent', reasons: ['hunks', 'groups'], hunks: { pending: 1, accepted: 0, rejected: 0 }, groupsPending: 1, lastSubmission: { status: 'delivered', at: new Date().toISOString() } })] } });
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

// Invariant: a row opens the review in its own checkout and drops view=inbox with every other review-scoped key.
test('a row links to its own project, worktree and review, with no view', async () => {
  history.replaceState(null, '', '?project=other&view=inbox');
  stubFetch({ 'GET api/inbox': { reviews: [inboxItem({ id: 'r-1', title: 'Mine' }), inboxItem({ id: 'r-9', title: 'Main', worktree: null })] } });
  render(<Inbox />);
  expect(parseRoute((await screen.findByRole('link', { name: /Main/ })).getAttribute('href')!)).toEqual({ project: 'app', review: 'r-9' });
  await userEvent.setup().click(screen.getByRole('link', { name: /Mine/ }));
  expect(parseRoute(location.search)).toEqual({ project: 'app', worktree: 'feature', review: 'r-1' });
});

const stale = { bucket: 'stale' as const };
const staleRegion = () => screen.getByRole('region', { name: /^Stale/ });
const expandStale = async () => userEvent.setup().click(within(staleRegion()).getByRole('button', { name: /^Stale/ }));

// Invariant: Stale is collapsed by default with its count in the header and its rows unrendered; the toggle reports aria-expanded and reveals the rows, each saying why it is stale.
test('Stale is collapsed with its count, and expands to rows with their stale reasons', async () => {
  vi.setSystemTime(new Date('2026-02-01T00:00:00Z'));
  stubFetch({
    'GET api/inbox': {
      reviews: [
        inboxItem({ ...quiet, ...needsYou, id: 'r-1', title: 'Active', reasons: ['threads'], threadStates: states({ awaitingHuman: 1 }) }),
        inboxItem({ ...quiet, ...stale, id: 'r-2', title: 'Old idea', lastActivityAt: '2026-01-02T00:00:00Z', staleReasons: ['idle'] }),
        inboxItem({ ...quiet, ...stale, id: 'r-3', title: 'Deleted checkout', staleReasons: ['checkout-gone', 'idle'], checkoutGone: true }),
      ],
    },
  });
  render(<Inbox />);
  await screen.findByText('Active');
  const toggle = within(staleRegion()).getByRole('button', { name: /^Stale/ });
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(within(toggle).getByLabelText('2 reviews')).toBeTruthy();
  expect(screen.queryByText('Old idea')).toBeNull();
  await userEvent.setup().click(toggle);
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(within(screen.getByRole('link', { name: /Old idea/ })).getByText('idle 30 d')).toBeTruthy();
  const gone = within(screen.getByRole('link', { name: /Deleted checkout/ }));
  expect(gone.getByText('checkout gone')).toBeTruthy();
  expect(gone.getByText('idle 31 d')).toBeTruthy();
  expect(within(screen.getByRole('region', { name: /Needs you/ })).queryByText('Old idea')).toBeNull();
  vi.useRealTimers();
});

// Invariant: Close shows only on rows whose checkout is gone, PATCHes status closed, then refetches the inbox.
test('Close shows only on gone rows, closes the review and refetches', async () => {
  const net = stubFetch({
    'GET api/inbox': { reviews: [inboxItem({ ...stale, id: 'r-1', title: 'Gone', checkoutGone: true, staleReasons: ['checkout-gone'] }), inboxItem({ id: 'r-2', title: 'Here' }), inboxItem({ id: 'r-3', title: 'Unknown', checkoutGone: null })] },
    'PATCH api/reviews/r-1': { review: {} },
  });
  render(<Inbox />);
  await screen.findByText('Here');
  await expandStale();
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
  const net = stubFetch({ 'GET api/inbox': { reviews: [inboxItem({ ...stale, title: 'Gone', checkoutGone: true, staleReasons: ['checkout-gone'] })] }, 'PATCH api/reviews/r-1': refusal('REVIEW_UNKNOWN', 404) });
  render(<Inbox />);
  await screen.findByRole('region', { name: /^Stale/ });
  await expandStale();
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
