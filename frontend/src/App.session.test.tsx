import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { expect, test, vi } from 'vitest';
import { ReviewHeader } from '@/features/review/ReviewHeader';
import { installBridge } from '@/test/fakeBridge';
import { installFakeEventSource } from '@/test/fakeEventSource';
import { renderInReview } from '@/test/renderCtx';
import { stubFetch } from '@/test/stubFetch';
import { App } from './App';

const world = () => stubFetch([
  [/^GET api\/projects$/, { projects: [{ name: 'app' }, { name: 'other' }] }],
  [/^GET api\/checkout\?/, { checkout: { project: 'app', worktree: null, path: '/x', branch: 'main', headSha: 'h', dirty: false, exists: true }, forkPoints: [], worktrees: [{ worktreeName: 'feature', branch: 'feature' }] }],
  [/^GET api\/sessions/, { sessions: [] }],
  [/^GET api\/reviews\?/, { reviews: [] }],
]);

test('without a bridge nothing follows and the route is untouched', async () => {
  installFakeEventSource();
  world();
  history.replaceState(null, '', '?project=app');
  render(<App />);
  await screen.findByText('No reviews yet');
  expect(location.search).toBe('?project=app');
});

test('a session in a local project switches the checkout, replacing the history entry', async () => {
  installFakeEventSource();
  world();
  const bridge = installBridge({ sessionId: 's-0', project: 'app', worktree: null });
  const replace = vi.spyOn(history, 'replaceState');
  history.replaceState(null, '', '?project=app');
  render(<App />);
  await screen.findByText('No reviews yet');
  act(() => bridge.emit({ sessionId: 's-1', project: 'other', worktree: 'feature' }));
  await waitFor(() => expect(location.search).toBe('?project=other&worktree=feature'));
  expect(replace).toHaveBeenCalledWith(null, '', '?project=other&worktree=feature');
});

test('a conductor or non-local session leaves the route alone and says so', async () => {
  installFakeEventSource();
  world();
  const bridge = installBridge(undefined);
  history.replaceState(null, '', '?project=app');
  render(<App />);
  await screen.findByText('No reviews yet');
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
  await screen.findByText('No reviews yet');
  await act(async () => {});
  expect(location.search).toBe('?project=app&worktree=feature');
});

test('with no route, the session’s checkout is used once it arrives', async () => {
  installFakeEventSource();
  world();
  const bridge = installBridge(undefined);
  render(<App />);
  act(() => bridge.emit({ sessionId: 's-1', project: 'app', worktree: null }));
  await waitFor(() => expect(location.search).toBe('?project=app'));
});

test('with no route and no session, the last checkout is restored', async () => {
  installFakeEventSource();
  world();
  localStorage.setItem('code-review:lastCheckout', JSON.stringify({ project: 'app', worktree: 'feature' }));
  render(<App />);
  await waitFor(() => expect(location.search).toBe('?project=app&worktree=feature'));
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
