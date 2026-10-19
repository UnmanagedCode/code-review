import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { expect, test, vi } from 'vitest';
import { agent, message, refusal, review, thread } from '@/test/fixtures';
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

test('focusing an unread thread through the route marks just that thread read', async () => {
  history.replaceState(null, '', '?thread=t-1');
  const net = stubFetch({ 'POST api/reviews/r-1/read': { review: review() } });
  renderInReview(<ThreadCard thread={thread({ unread: 2 })} />);
  await waitFor(() => expect(net.calls.map((c) => c.body)).toEqual([{ threadId: 't-1' }]));
});

test('a thread that is not focused is not marked read', () => {
  const net = stubFetch({ 'POST api/reviews/r-1/read': { review: review() } });
  renderInReview(<ThreadCard thread={thread({ unread: 2 })} />);
  expect(net.calls).toEqual([]);
});

test('a round view says how many later replies it hides, and nothing when there are none', () => {
  const { unmount } = renderInReview(<ThreadCard thread={thread({ laterMessages: 2 })} />, { round: 1, readOnly: true });
  expect(screen.getByText(/2 later replies/)).toBeTruthy();
  unmount();
  renderInReview(<ThreadCard thread={thread({ laterMessages: 0 })} />, { round: 1, readOnly: true });
  expect(screen.queryByText(/later repl/)).toBeNull();
});

test('focusing a thread in a round view posts no read mark and offers no reply', async () => {
  history.replaceState(null, '', '?round=1&thread=t-1');
  const net = stubFetch({});
  renderInReview(<ThreadCard thread={thread({ unread: 0 })} />, { round: 1, readOnly: true });
  await waitFor(() => expect(screen.getByRole('article')).toBeTruthy());
  expect(net.calls).toEqual([]);
  expect(screen.queryByLabelText('Reply')).toBeNull();
});

// Invariant: thread cards render message bodies through the markdown renderer.
test('a message body renders as markdown', () => {
  renderInReview(<ThreadCard thread={thread({ messages: [message({ body: '**bold** and `x`' })] })} />);
  const card = screen.getByRole('article');
  expect(within(card).getByText('bold').tagName).toBe('STRONG');
  expect(within(card).getByText('x').tagName).toBe('CODE');
});

// Invariant: Reply and the thread's status controls render together in one action group, for every status variant.
test.each([
  ['an open comment', thread(), ['Resolve']],
  ['an open finding', thread({ kind: 'finding', severity: 'major' }), ['Resolve as fixed', 'Resolve as dismissed']],
  ['a resolved thread', thread({ status: 'resolved' }), ['Reopen']],
  ['an outdated thread', thread({ status: 'outdated' }), []],
])('Reply and the status controls share one Thread actions group: %s', (_name, t, controls) => {
  renderInReview(<ThreadCard thread={t} />);
  const group = screen.getByRole('group', { name: 'Thread actions' });
  expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual([...controls, 'Reply']);
});

// Invariant: a status control inside the reply form never submits it, so a typed draft is neither posted nor cleared.
test('Resolve inside the reply form does not submit the draft', async () => {
  const net = stubFetch({ 'PATCH api/reviews/r-1/threads/t-1': { thread: thread() }, 'POST api/reviews/r-1/threads/t-1/messages': { thread: thread() } });
  const user = userEvent.setup();
  renderInReview(<ThreadCard thread={thread()} />);
  await user.type(screen.getByLabelText('Reply'), 'wip');
  await user.click(screen.getByRole('button', { name: 'Resolve' }));
  await waitFor(() => expect(patchBody(net)).toEqual({ status: 'resolved' }));
  expect(net.calls.map((c) => `${c.method} ${c.url.pathname}`)).toEqual(['PATCH /api/reviews/r-1/threads/t-1']);
  expect(screen.getByLabelText<HTMLTextAreaElement>('Reply').value).toBe('wip');
});
