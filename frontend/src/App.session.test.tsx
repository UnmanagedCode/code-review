import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { expect, test, vi } from 'vitest';
import { ReviewHeader } from '@/features/review/ReviewHeader';
import { installBridge } from '@/test/fakeBridge';
import { installFakeEventSource } from '@/test/fakeEventSource';
import { diffFile, fileState, inboxItem, review } from '@/test/fixtures';
import { renderInReview } from '@/test/renderCtx';
import { stubFetch } from '@/test/stubFetch';
import { PROJECTS_RECHECK_MS } from '@/features/layout/useFollowSession';
import { App } from './App';

const world = () => stubFetch([
  [/^GET api\/projects$/, { projects: [{ name: 'app' }, { name: 'other' }] }],
  [/^GET api\/checkout\?/, { checkout: { project: 'app', worktree: null, path: '/x', branch: 'main', headSha: 'h', dirty: false, exists: true }, forkPoints: [], worktrees: [{ worktreeName: 'feature', branch: 'feature' }] }],
  [/^GET api\/sessions\/[^/?]+\/places$/, { places: [] }],
  [/^GET api\/sessions/, { sessions: [] }],
  [/^GET api\/reviews\?/, { reviews: [] }],
  [/^GET api\/inbox$/, { reviews: [] }],
  [/^GET api\/reviews\/r-1$/, { review: review({ title: 'Open review' }), files: [fileState({ path: 'a.js' })], rounds: [{ n: 1, headSha: 'a'.repeat(40), baseSha: 'b'.repeat(40), createdAt: '', submittedAt: null }], submissions: [], outdatedThreads: [], reviewThreads: [], openThreads: [], activity: [] }],
  [/^GET api\/reviews\/r-1\/diff/, { review: review({ title: 'Open review' }), files: [diffFile({ path: 'a.js' })] }],
  [/^GET api\/reviews\/r-1\/commits/, { commits: [] }],
]);

test('without a bridge nothing follows and the route is untouched', async () => {
  installFakeEventSource();
  world();
  history.replaceState(null, '', '?project=app');
  render(<App />);
  await screen.findByText('No open reviews');
  expect(location.search).toBe('?project=app');
});

test('a session in a local project switches the checkout, replacing the history entry', async () => {
  installFakeEventSource();
  world();
  const bridge = installBridge({ sessionId: 's-0', project: 'app', worktree: null });
  const replace = vi.spyOn(history, 'replaceState');
  history.replaceState(null, '', '?project=app');
  render(<App />);
  await screen.findByText('No open reviews');
  act(() => bridge.emit({ sessionId: 's-1', project: 'other', worktree: 'feature' }));
  await waitFor(() => expect(location.search).toBe('?project=other&worktree=feature'));
  expect(replace).toHaveBeenCalledWith(null, '', '?project=other&worktree=feature');
});

test('a conductor or unlisted session leaves the route alone and says so', async () => {
  installFakeEventSource();
  world();
  const bridge = installBridge(undefined);
  history.replaceState(null, '', '?project=app');
  render(<App />);
  await screen.findByText('No open reviews');
  act(() => bridge.emit({ sessionId: 's-c', project: '.conduct', worktree: null }));
  expect(await screen.findByText('Active session’s project isn’t reviewable here')).toBeTruthy();
  expect(location.search).toBe('?project=app');
});

test('a checkout named by the route wins over the session on load', async () => {
  installFakeEventSource();
  world();
  installBridge({ sessionId: 's-1', project: 'other', worktree: null });
  history.replaceState(null, '', '?project=app&worktree=feature');
  render(<App />);
  await screen.findByText('No open reviews');
  await act(async () => {});
  expect(location.search).toBe('?project=app&worktree=feature');
});

test('with no route, the session’s checkout is used once it arrives', async () => {
  installFakeEventSource();
  world();
  const bridge = installBridge(undefined);
  render(<App />);
  act(() => bridge.emit({ sessionId: 's-1', project: 'app', worktree: null }));
  await waitFor(() => expect(location.search).toBe('?project=app&view=inbox'));
});

test('with no route and no session, the last checkout is restored', async () => {
  installFakeEventSource();
  world();
  localStorage.setItem('code-review:lastCheckout', JSON.stringify({ project: 'app', worktree: 'feature' }));
  render(<App />);
  await waitFor(() => expect(location.search).toBe('?project=app&worktree=feature&view=inbox'));
});

test('Open agent calls openSession(recipient) and toasts a failure code; it is absent without a bridge', async () => {
  const { unmount } = renderInReview(<ReviewHeader />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Review actions' }));
  expect(screen.queryByRole('menuitem', { name: 'Open agent' })).toBeNull();
  unmount();

  const error = vi.spyOn(toast, 'error').mockImplementation(() => '');
  const bridge = installBridge();
  bridge.openSession.mockResolvedValue({ ok: false, code: 'SESSION_NOT_LIVE' });
  renderInReview(<ReviewHeader />);
  await user.click(screen.getByRole('button', { name: 'Review actions' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Open agent' }));
  expect(bridge.openSession).toHaveBeenCalledWith('s-author');
  await waitFor(() => expect(error).toHaveBeenCalledWith("The session isn't running"));
});

// Invariant: a session change while a review is open is dropped (the route stays); leaving the review does not replay it; the next session change follows again.
test('a session change while a review is open is ignored, not deferred', async () => {
  installFakeEventSource();
  world();
  const bridge = installBridge({ sessionId: 's-0', project: 'app', worktree: 'feature' });
  history.replaceState(null, '', '?project=app&worktree=feature&review=r-1');
  render(<App />);
  await screen.findByRole('heading', { level: 1, name: 'Open review' });
  act(() => bridge.emit({ sessionId: 's-1', project: 'other', worktree: null }));
  await act(async () => {});
  expect(location.search).toBe('?project=app&worktree=feature&review=r-1');
  expect(screen.getByRole('heading', { level: 1, name: 'Open review' })).toBeTruthy();

  await userEvent.setup().click(screen.getByRole('link', { name: 'Reviews' }));
  await screen.findByText('No open reviews');
  await act(async () => {});
  expect(location.search).toBe('?project=app&worktree=feature');

  act(() => bridge.emit({ sessionId: 's-2', project: 'other', worktree: 'feature' }));
  await waitFor(() => expect(location.search).toBe('?project=other&worktree=feature'));
});

// Invariant: following on the inbox switches the checkout and keeps view=inbox.
test('a session change on the inbox updates the checkout and keeps the inbox', async () => {
  installFakeEventSource();
  world();
  const bridge = installBridge({ sessionId: 's-0', project: 'app', worktree: null });
  history.replaceState(null, '', '?project=app&view=inbox');
  render(<App />);
  const inbox = () => within(screen.getByRole('tabpanel', { name: 'Inbox' }));
  await waitFor(() => expect(inbox().getByText('No open reviews')).toBeTruthy());
  act(() => bridge.emit({ sessionId: 's-1', project: 'other', worktree: 'feature' }));
  await waitFor(() => expect(location.search).toBe('?project=other&worktree=feature&view=inbox'));
  expect(inbox().getByText('No open reviews')).toBeTruthy();
});

// Invariant: the first-run checkout (from the session, or the last one used) fills in project and keeps view=inbox.
test('?view=inbox with no project keeps the inbox when the checkout fills in', async () => {
  installFakeEventSource();
  world();
  const bridge = installBridge(undefined);
  history.replaceState(null, '', '?view=inbox');
  const { unmount } = render(<App />);
  act(() => bridge.emit({ sessionId: 's-1', project: 'app', worktree: null }));
  await waitFor(() => expect(location.search).toBe('?project=app&view=inbox'));
  unmount();
  delete window.ccBridge;

  localStorage.setItem('code-review:lastCheckout', JSON.stringify({ project: 'app', worktree: 'feature' }));
  history.replaceState(null, '', '?view=inbox');
  render(<App />);
  await waitFor(() => expect(location.search).toBe('?project=app&worktree=feature&view=inbox'));
});

// Invariant: a session change to a project the cached project list lacks refetches a list older than PROJECTS_RECHECK_MS
// (so a project created since becomes followable) and leaves a fresh list alone.
test('a session for an unlisted project rechecks a stale project list, not a fresh one', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  installFakeEventSource();
  const net = world();
  const bridge = installBridge({ sessionId: 's-0', project: 'app', worktree: null });
  history.replaceState(null, '', '?project=app');
  render(<App />);
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(net.count('GET api/projects')).toBe(1);
  act(() => bridge.emit({ sessionId: 's-1', project: 'brand-new', worktree: null }));
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(net.count('GET api/projects')).toBe(1);
  await act(() => vi.advanceTimersByTimeAsync(PROJECTS_RECHECK_MS + 1));
  act(() => bridge.emit({ sessionId: 's-2', project: 'brand-newer', worktree: null }));
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(net.count('GET api/projects')).toBe(2);
});

/** `world()` with an inbox of the given rows. */
const withInbox = (rows: ReturnType<typeof inboxItem>[], hold?: Promise<void>) => stubFetch([
  [/^GET api\/projects$/, { projects: [{ name: 'app' }, { name: 'other' }] }],
  [/^GET api\/checkout\?/, { checkout: { project: 'app', worktree: null, path: '/x', branch: 'main', headSha: 'h', dirty: false, exists: true }, forkPoints: [], worktrees: [] }],
  [/^GET api\/sessions\/[^/?]+\/places$/, { places: [] }],
  [/^GET api\/sessions/, { sessions: [] }],
  [/^GET api\/reviews\?/, { reviews: [] }],
  [/^GET api\/inbox$/, async () => { await hold; return { reviews: rows }; }],
  [/^GET api\/reviews\/r-1$/, { review: review({ title: 'Open review' }), files: [fileState({ path: 'a.js' })], rounds: [{ n: 1, headSha: 'a'.repeat(40), baseSha: 'b'.repeat(40), createdAt: '', submittedAt: null }], submissions: [], outdatedThreads: [], reviewThreads: [], openThreads: [], activity: [] }],
  [/^GET api\/reviews\/r-1\/diff/, { review: review({ title: 'Open review' }), files: [diffFile({ path: 'a.js' })] }],
  [/^GET api\/reviews\/r-1\/commits/, { commits: [] }],
]);
const mine = (over: Partial<ReturnType<typeof inboxItem>> = {}) => inboxItem({ id: 'r-1', title: 'Open review', recipient: 's-1', ...over });

// Invariant: embedded, a session that is the recipient or author of exactly one open review lands on it, replacing the history entry.
test('embedded load with a single review for the session opens it with replace', async () => {
  installFakeEventSource();
  withInbox([mine(), mine({ id: 'r-2', recipient: 's-other' })]);
  installBridge({ sessionId: 's-1', project: 'app', worktree: null });
  const length = history.length;
  const replace = vi.spyOn(history, 'replaceState');
  render(<App />);
  await screen.findByRole('heading', { level: 1, name: 'Open review' });
  expect(location.search).toBe('?project=app&worktree=feature&review=r-1');
  expect(replace).toHaveBeenCalledWith(null, '', '?project=app&worktree=feature&review=r-1');
  expect(history.length).toBe(length);
});

// Invariant: a conductor named as the review's author counts as its session too.
test('a review whose author is the session counts as the session’s', async () => {
  installFakeEventSource();
  withInbox([mine({ recipient: 's-author', author: 's-1' })]);
  installBridge({ sessionId: 's-1', project: 'app', worktree: null });
  render(<App />);
  await screen.findByRole('heading', { level: 1, name: 'Open review' });
});

// Invariant: with no review or several, the session lands on the inbox of its own checkout.
test.each([[[]], [[mine(), mine({ id: 'r-2', author: 's-1', recipient: 's-x' })]]])('embedded load with %# reviews of the session lands on the inbox', async (rows) => {
  installFakeEventSource();
  withInbox(rows);
  installBridge({ sessionId: 's-1', project: 'app', worktree: 'feature' });
  render(<App />);
  await waitFor(() => expect(location.search).toBe('?project=app&worktree=feature&view=inbox'));
});

// Invariant: a later session change with no review open lands the new session on its single review, or keeps the current tab.
test('a later session change opens the new session’s single review, else keeps the tab', async () => {
  installFakeEventSource();
  withInbox([mine({ recipient: 's-2' })]);
  const bridge = installBridge({ sessionId: 's-0', project: 'app', worktree: null });
  history.replaceState(null, '', '?project=app');
  render(<App />);
  await act(async () => {});
  act(() => bridge.emit({ sessionId: 's-3', project: 'other', worktree: null }));
  await waitFor(() => expect(location.search).toBe('?project=other'));
  act(() => bridge.emit({ sessionId: 's-2', project: 'app', worktree: null }));
  await screen.findByRole('heading', { level: 1, name: 'Open review' });
  expect(location.search).toBe('?project=app&worktree=feature&review=r-1');
});

// Invariant: an answer that arrives after the user navigated is dropped: their move stands.
test('a landing that resolves after a user navigation is dropped', async () => {
  installFakeEventSource();
  let release!: () => void;
  withInbox([mine()], new Promise<void>((r) => { release = r; }));
  installBridge({ sessionId: 's-1', project: 'app', worktree: null });
  render(<App />);
  await act(async () => {});
  act(() => { history.pushState(null, '', '?project=other'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await act(async () => { release(); });
  await act(async () => {});
  expect(location.search).toBe('?project=other');
});

// Invariant: a session change while the New review dialog is open leaves it open (it follows the session by itself), even when the session has a single review.
test('a session change while the New review dialog is open is ignored', async () => {
  installFakeEventSource();
  withInbox([mine({ recipient: 's-2' })]);
  const bridge = installBridge({ sessionId: 's-0', project: 'app', worktree: null });
  history.replaceState(null, '', '?project=app&view=new');
  render(<App />);
  await screen.findByRole('dialog');
  act(() => bridge.emit({ sessionId: 's-2', project: 'app', worktree: null }));
  await act(async () => {});
  expect(location.search).toBe('?project=app&view=new');
});

// Invariant: the pending landing's Inbox default is not a lock. When the project list fails, the landing settles and the Checkout tab (with its Retry) is reachable; a clicked tab wins even while pending.
test('a failed project list does not lock the Inbox tab: Checkout and its Retry stay reachable', async () => {
  installFakeEventSource();
  stubFetch([
    [/^GET api\/projects$/, new Response(JSON.stringify({ ok: false, code: 'CONDUCTOR_UNAVAILABLE', reason: 'down' }), { status: 502 })],
    [/^GET api\/inbox$/, { reviews: [] }],
  ]);
  history.replaceState(null, '', '/');
  render(<App />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('tab', { name: 'Checkout' }));
  expect(screen.getByRole('tab', { name: 'Checkout' }).getAttribute('aria-selected')).toBe('true');
  expect(await screen.findByRole('button', { name: 'Retry' })).toBeTruthy();
});

// Invariant: an explicit Checkout click cancels the pending landing: when the project list (standalone) or the inbox (embedded) resolves afterwards, nothing navigates over the choice.
test.each(['standalone', 'embedded'])('a Checkout click during a %s landing sticks after the landing resolves', async (mode) => {
  installFakeEventSource();
  let release!: () => void;
  const hold = new Promise<void>((r) => { release = r; });
  stubFetch([
    [/^GET api\/projects$/, async () => { if (mode === 'standalone') await hold; return { projects: [{ name: 'app' }] }; }],
    [/^GET api\/checkout\?/, { checkout: { project: 'app', worktree: null, path: '/x', branch: 'main', headSha: 'h', dirty: false, exists: true }, forkPoints: [], worktrees: [] }],
    [/^GET api\/sessions/, { sessions: [] }],
    [/^GET api\/reviews\?/, { reviews: [] }],
    [/^GET api\/inbox$/, async () => { if (mode === 'embedded') await hold; return { reviews: [] }; }],
  ]);
  if (mode === 'embedded') installBridge({ sessionId: 's-none', project: 'app', worktree: null });
  history.replaceState(null, '', '/');
  render(<App />);
  await userEvent.setup().click(await screen.findByRole('tab', { name: 'Checkout' }));
  await act(async () => { release(); });
  await act(async () => {});
  expect(screen.getByRole('tab', { name: 'Checkout' }).getAttribute('aria-selected')).toBe('true');
  expect(location.search).not.toContain('view=inbox');
});
