import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { expect, test, vi } from 'vitest';
import { agent, message, refusal, thread } from '@/test/fixtures';
import { renderInReview } from '@/test/renderCtx';
import { stubFetch } from '@/test/stubFetch';
import { ThreadCard } from './ThreadCard';

const patchBody = (net: ReturnType<typeof stubFetch>) => net.calls.find((c) => c.method === 'PATCH')?.body;

test('author, reviewer and conductor badges come from the frozen author.role, with the session title', () => {
  const t = thread({ messages: [
    message({ id: 1, author: agent('s-a', 'author') }), message({ id: 2, author: agent('s-r', 'reviewer') }), message({ id: 3, author: agent('s-c', 'conductor') }),
  ] });
  renderInReview(<ThreadCard thread={t} />, { sessions: [{ sessionId: 's-a', project: 'app', worktree: null, title: 'Builder', status: 'idle', live: true, conductor: false, conducted: false, attached: true }] });
  for (const role of ['author', 'reviewer', 'conductor']) expect(screen.getAllByText(role).length).toBeGreaterThan(0);
  expect(screen.getByText('Builder')).toBeTruthy();
  expect(screen.getByText('s-r')).toBeTruthy();
});

test('resolving a finding sends a disposition; a non-finding sends none', async () => {
  const net = stubFetch({ 'PATCH api/reviews/r-1/threads/t-1': { thread: thread() } });
  const user = userEvent.setup();
  const { unmount } = renderInReview(<ThreadCard thread={thread({ kind: 'finding', severity: 'major' })} />);
  await user.click(screen.getByRole('button', { name: 'Resolve as dismissed' }));
  await waitFor(() => expect(patchBody(net)).toEqual({ status: 'resolved', disposition: 'dismissed' }));
  unmount();
  const net2 = stubFetch({ 'PATCH api/reviews/r-1/threads/t-1': { thread: thread() } });
  renderInReview(<ThreadCard thread={thread()} />);
  await user.click(screen.getByRole('button', { name: 'Resolve' }));
  await waitFor(() => expect(patchBody(net2)).toEqual({ status: 'resolved' }));
});

test('a resolved thread offers Reopen', async () => {
  const net = stubFetch({ 'PATCH api/reviews/r-1/threads/t-1': { thread: thread() } });
  renderInReview(<ThreadCard thread={thread({ status: 'resolved' })} />);
  await userEvent.setup().click(screen.getByRole('button', { name: 'Reopen' }));
  await waitFor(() => expect(patchBody(net)).toEqual({ status: 'open' }));
});

test('an outdated thread has no status controls but keeps a reply box, and says where it was', () => {
  renderInReview(<ThreadCard thread={thread({ status: 'outdated', anchor: { ...thread().anchor, startLine: 10, endLine: 14, round: 2 } })} />);
  expect(screen.getByText('outdated · was L10–L14 (new) at round 2')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Resolve|Reopen/ })).toBeNull();
  expect(screen.getByLabelText('Reply')).toBeTruthy();
});

test('resolveProposed shows a banner and a proposing message is badged', () => {
  renderInReview(<ThreadCard thread={thread({ resolveProposed: true, messages: [message({ author: agent(), proposeResolve: true })] })} />);
  expect(screen.getByText('An agent proposes resolving this thread.')).toBeTruthy();
  expect(screen.getByText('proposes resolution')).toBeTruthy();
});

test('a drifted anchor is flagged', () => {
  renderInReview(<ThreadCard thread={thread({ anchor: { ...thread().anchor, drifted: true } })} />);
  expect(screen.getByText('re-anchored by context')).toBeTruthy();
});

test('a reply refused THREAD_DROPPED shows the dropped message', async () => {
  const error = vi.spyOn(toast, 'error').mockImplementation(() => '');
  stubFetch({ 'POST api/reviews/r-1/threads/t-1/messages': refusal('THREAD_DROPPED') });
  const user = userEvent.setup();
  const { value } = renderInReview(<ThreadCard thread={thread()} dropped />);
  expect(screen.getByText('dropped: its lines changed')).toBeTruthy();
  await user.type(screen.getByLabelText('Reply'), 'hi');
  await user.click(screen.getByRole('button', { name: 'Reply' }));
  await waitFor(() => expect(error).toHaveBeenCalledWith('Its lines changed, so the thread was dropped'));
  expect(value.reload).toHaveBeenCalled();
});
