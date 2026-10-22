import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { expect, test, vi } from 'vitest';
import { parseRoute } from '@/lib/route';
import { installBridge } from '@/test/fakeBridge';
import { review } from '@/test/fixtures';
import { stubFetch } from '@/test/stubFetch';
import { NewReviewDialog } from './NewReviewDialog';

const commits = [{ sha: 'c'.repeat(40), short: 'ccccccc', author: 'a', date: 'd', subject: 'second', merge: false }, { sha: 'd'.repeat(40), short: 'ddddddd', author: 'a', date: 'd', subject: 'first', merge: false }];
function world(forkPoints = [{ ref: 'main', label: 'main (parent)', forkSha: 'f'.repeat(40) }], reused = false, sessions: unknown[] = []) {
  return stubFetch({
    'GET api/checkout': { checkout: { project: 'app', worktree: 'feature', path: '/x', branch: 'feature', headSha: 'h', dirty: false, exists: true }, forkPoints, worktrees: [] },
    'GET api/checkout/commits': { commits },
    'GET api/sessions': { sessions },
    'POST api/reviews': { review: review({ id: 'r-9' }), reused },
  });
}
const opened = (net: ReturnType<typeof world>) => net.calls.find((c) => c.method === 'POST')?.body;

test('range posts the fork-point shortcut as base', async () => {
  const net = world();
  const user = userEvent.setup();
  render(<NewReviewDialog project="app" worktree="feature" onClose={() => {}} />);
  await waitFor(() => expect(screen.getByRole('radio', { name: /main \(parent\)/ }).getAttribute('aria-checked')).toBe('true'));
  await user.click(screen.getByRole('button', { name: 'Open review' }));
  await waitFor(() => expect(opened(net)).toEqual({ project: 'app', worktree: 'feature', kind: 'range', base: 'main' }));
});

test('range posts a picked commit sha as base', async () => {
  const net = world();
  const user = userEvent.setup();
  render(<NewReviewDialog project="app" worktree="feature" onClose={() => {}} />);
  await user.click(await screen.findByRole('radio', { name: 'Another commit' }));
  await user.selectOptions(await screen.findByLabelText('Base commit'), 'd'.repeat(40));
  await user.click(screen.getByRole('button', { name: 'Open review' }));
  await waitFor(() => expect(opened(net)).toMatchObject({ kind: 'range', base: 'd'.repeat(40) }));
});

test('a main checkout without a fork point cannot submit until a base is picked', async () => {
  world([]);
  render(<NewReviewDialog project="app" worktree={null} onClose={() => {}} />);
  const open = await screen.findByRole('button', { name: 'Open review' });
  expect((open as HTMLButtonElement).disabled).toBe(true);
});

test('commit posts the chosen sha; uncommitted posts neither base nor sha', async () => {
  const net = world();
  const user = userEvent.setup();
  const { unmount } = render(<NewReviewDialog project="app" worktree="feature" onClose={() => {}} />);
  await user.click(screen.getByRole('radio', { name: /One commit/ }));
  await user.selectOptions(await screen.findByLabelText('Commit'), 'c'.repeat(40));
  await user.click(screen.getByRole('button', { name: 'Open review' }));
  await waitFor(() => expect(opened(net)).toEqual({ project: 'app', worktree: 'feature', kind: 'commit', sha: 'c'.repeat(40) }));
  unmount();
  const net2 = world();
  render(<NewReviewDialog project="app" worktree="feature" onClose={() => {}} />);
  await user.click(screen.getByRole('radio', { name: /Uncommitted/ }));
  await user.click(screen.getByRole('button', { name: 'Open review' }));
  await waitFor(() => expect(opened(net2)).toEqual({ project: 'app', worktree: 'feature', kind: 'uncommitted' }));
});

test('a reused review is announced and navigated to', async () => {
  world(undefined, true);
  const info = vi.spyOn(toast, 'info').mockImplementation(() => '');
  const onClose = vi.fn();
  const user = userEvent.setup();
  render(<NewReviewDialog project="app" worktree="feature" onClose={onClose} />);
  await waitFor(() => expect((screen.getByRole('button', { name: 'Open review' }) as HTMLButtonElement).disabled).toBe(false));
  await user.click(screen.getByRole('button', { name: 'Open review' }));
  await waitFor(() => expect(location.search).toContain('review=r-9'));
  expect(onClose).toHaveBeenCalled();
  expect(info).toHaveBeenCalledWith('Opened the existing review');
});

test('opening the new review drops every review-scoped key of the one before, round included', async () => {
  history.replaceState(null, '', '?project=app&worktree=feature&review=r-1&round=1&file=a.js&thread=t-1&view=new');
  world();
  const user = userEvent.setup();
  render(<NewReviewDialog project="app" worktree="feature" onClose={() => {}} />);
  await waitFor(() => expect((screen.getByRole('button', { name: 'Open review' }) as HTMLButtonElement).disabled).toBe(false));
  await user.click(screen.getByRole('button', { name: 'Open review' }));
  await waitFor(() => expect(parseRoute(location.search)).toEqual({ project: 'app', worktree: 'feature', review: 'r-9' }));
});

const sess = (sessionId: string, label: string, live = true) => ({ sessionId, project: 'app', worktree: 'feature', label: label || null, status: live ? 'idle' : 'exited', live, conductor: false, conducted: false, attached: live });
const sessions = [sess('s-1', 'Fix login'), sess('s-2', 'Other work'), sess('s-dead', 'Gone', false), sess('s-bare', '')];
const fields = () => ({ title: (screen.getByLabelText('Title (optional)') as HTMLInputElement).value, recipient: (screen.getByLabelText('Recipient session') as HTMLSelectElement).value });

test('a live active session prefills the recipient and its title, and both are posted', async () => {
  installBridge({ sessionId: 's-1', project: 'app', worktree: 'feature' });
  const net = world(undefined, false, sessions);
  const user = userEvent.setup();
  render(<NewReviewDialog project="app" worktree="feature" onClose={() => {}} />);
  await waitFor(() => expect(fields()).toEqual({ title: 'Fix login', recipient: 's-1' }));
  await waitFor(() => expect((screen.getByRole('button', { name: 'Open review' }) as HTMLButtonElement).disabled).toBe(false));
  await user.click(screen.getByRole('button', { name: 'Open review' }));
  await waitFor(() => expect(opened(net)).toMatchObject({ title: 'Fix login', recipient: 's-1' }));
});

test('a dead active session prefills only the title; the recipient stays Default', async () => {
  installBridge({ sessionId: 's-dead', project: 'app', worktree: 'feature' });
  world(undefined, false, sessions);
  render(<NewReviewDialog project="app" worktree="feature" onClose={() => {}} />);
  await waitFor(() => expect(fields()).toEqual({ title: 'Gone', recipient: '' }));
});

test('a live session without a title still becomes the recipient, with the title left blank', async () => {
  installBridge({ sessionId: 's-bare', project: 'app', worktree: 'feature' });
  world(undefined, false, sessions);
  render(<NewReviewDialog project="app" worktree="feature" onClose={() => {}} />);
  await waitFor(() => expect(fields()).toEqual({ title: '', recipient: 's-bare' }));
});

test('an unlisted, null or absent active session leaves both fields blank', async () => {
  for (const session of [{ sessionId: 'unlisted', project: 'app', worktree: 'feature' }, null, undefined]) {
    const net = world(undefined, false, sessions);
    installBridge(session);
    const { unmount } = render(<NewReviewDialog project="app" worktree="feature" onClose={() => {}} />);
    await waitFor(() => expect(net.count('GET api/sessions')).toBe(1));
    await screen.findByRole('option', { name: 'Fix login' });
    expect(fields()).toEqual({ title: '', recipient: '' });
    unmount();
  }
});

test('an edited title is kept when the active session changes, while the recipient follows', async () => {
  const bridge = installBridge({ sessionId: 's-1', project: 'app', worktree: 'feature' });
  world(undefined, false, sessions);
  const user = userEvent.setup();
  render(<NewReviewDialog project="app" worktree="feature" onClose={() => {}} />);
  await waitFor(() => expect(fields().recipient).toBe('s-1'));
  const title = screen.getByLabelText('Title (optional)');
  await user.clear(title);
  await user.type(title, 'Mine');
  act(() => bridge.emit({ sessionId: 's-2', project: 'app', worktree: 'feature' }));
  await waitFor(() => expect(fields()).toEqual({ title: 'Mine', recipient: 's-2' }));
});

test('choosing Default for the recipient pins it against a later session change', async () => {
  const bridge = installBridge({ sessionId: 's-1', project: 'app', worktree: 'feature' });
  world(undefined, false, sessions);
  const user = userEvent.setup();
  render(<NewReviewDialog project="app" worktree="feature" onClose={() => {}} />);
  await waitFor(() => expect(fields().recipient).toBe('s-1'));
  await user.selectOptions(screen.getByLabelText('Recipient session'), '');
  act(() => bridge.emit({ sessionId: 's-2', project: 'app', worktree: 'feature' }));
  await waitFor(() => expect(fields().title).toBe('Other work'));
  expect(fields().recipient).toBe('');
});

test('a title typed and a recipient picked before the sessions arrive are not overwritten by the prefill', async () => {
  installBridge({ sessionId: 's-1', project: 'app', worktree: 'feature' });
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const sessionsResponder = async () => { await gate; return { sessions }; };
  stubFetch({
    'GET api/checkout': { checkout: { project: 'app', worktree: 'feature', path: '/x', branch: 'feature', headSha: 'h', dirty: false, exists: true }, forkPoints: [{ ref: 'main', label: 'main (parent)', forkSha: 'f'.repeat(40) }], worktrees: [] },
    'GET api/checkout/commits': { commits },
    'GET api/sessions': sessionsResponder,
  });
  const user = userEvent.setup();
  render(<NewReviewDialog project="app" worktree="feature" onClose={() => {}} />);
  await user.type(screen.getByLabelText('Title (optional)'), 'Early');
  await user.selectOptions(screen.getByLabelText('Recipient session'), '');
  release();
  await screen.findByRole('option', { name: 'Fix login' });
  await waitFor(() => expect(fields()).toEqual({ title: 'Early', recipient: '' }));
});
