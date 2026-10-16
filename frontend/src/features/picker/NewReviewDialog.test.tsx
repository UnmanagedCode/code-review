import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { review } from '@/test/fixtures';
import { stubFetch } from '@/test/stubFetch';
import { NewReviewDialog } from './NewReviewDialog';

const commits = [{ sha: 'c'.repeat(40), short: 'ccccccc', author: 'a', date: 'd', subject: 'second', merge: false }, { sha: 'd'.repeat(40), short: 'ddddddd', author: 'a', date: 'd', subject: 'first', merge: false }];
function world(forkPoints = [{ ref: 'main', label: 'main (parent)', forkSha: 'f'.repeat(40) }], reused = false) {
  return stubFetch({
    'GET api/checkout': { checkout: { project: 'app', worktree: 'feature', path: '/x', branch: 'feature', headSha: 'h', dirty: false, exists: true }, forkPoints, worktrees: [] },
    'GET api/checkout/commits': { commits },
    'GET api/sessions': { sessions: [] },
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
  const onClose = vi.fn();
  const user = userEvent.setup();
  render(<NewReviewDialog project="app" worktree="feature" onClose={onClose} />);
  await waitFor(() => expect((screen.getByRole('button', { name: 'Open review' }) as HTMLButtonElement).disabled).toBe(false));
  await user.click(screen.getByRole('button', { name: 'Open review' }));
  await waitFor(() => expect(location.search).toContain('review=r-9'));
  expect(onClose).toHaveBeenCalled();
});
