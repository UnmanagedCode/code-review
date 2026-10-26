import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { resetCodeGit } from '@/lib/codeGit';
import { parseRoute } from '@/lib/route';
import { installBridge } from '@/test/fakeBridge';
import { installTop } from '@/test/fakeTop';
import { refusal, review } from '@/test/fixtures';
import { renderInReview } from '@/test/renderCtx';
import { stubFetch } from '@/test/stubFetch';
import { ReviewHeader } from './ReviewHeader';

test('"Mark all read" posts read with an empty body (the whole review)', async () => {
  const net = stubFetch({ 'POST api/reviews/r-1/read': { review: review() } });
  const user = userEvent.setup();
  renderInReview(<ReviewHeader />);
  await user.click(screen.getByRole('button', { name: 'Review actions' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Mark all read' }));
  await waitFor(() => expect(net.calls.map((c) => c.body)).toEqual([{}]));
});

test('"Reviews" from a past-round view leaves every review-scoped key behind, round included', async () => {
  history.replaceState(null, '', '?project=app&worktree=feature&review=r-1&round=1&file=a.js&lines=3&thread=t-1');
  renderInReview(<ReviewHeader />, { round: 1, readOnly: true });
  await userEvent.setup().click(screen.getByRole('link', { name: 'Reviews' }));
  expect(parseRoute(location.search)).toEqual({ project: 'app', worktree: 'feature' });
});

// Invariant: the Inbox link leaves the review with every review-scoped key and lands on view=inbox in the same checkout.
test('"Inbox" leaves the review and its review-scoped keys and opens the inbox', async () => {
  history.replaceState(null, '', '?project=app&worktree=feature&review=r-1&round=1&file=a.js&lines=3&thread=t-1&view=threads');
  renderInReview(<ReviewHeader />, { round: 1, readOnly: true });
  await userEvent.setup().click(screen.getByRole('link', { name: 'Inbox' }));
  expect(parseRoute(location.search)).toEqual({ project: 'app', worktree: 'feature', view: 'inbox' });
});

test('a past-round view offers no review-level writes: no Submit round, no actions menu, no recipient picker', () => {
  renderInReview(<ReviewHeader />, { round: 1, readOnly: true });
  expect(screen.queryByRole('button', { name: 'Submit round' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Review actions' })).toBeNull();
  expect(screen.queryByRole('button', { name: /Recipient/ })).toBeNull();
});

test('in a past-round view the actions menu, when a bridge can open the agent, holds only "Open agent"', async () => {
  installBridge();
  const user = userEvent.setup();
  renderInReview(<ReviewHeader />, { round: 1, readOnly: true });
  await user.click(screen.getByRole('button', { name: 'Review actions' }));
  const items = await screen.findAllByRole('menuitem');
  expect(items.map((i) => i.textContent)).toEqual(['Open agent']);
});

test('the commit-filter view keeps the review-level controls', async () => {
  const user = userEvent.setup();
  renderInReview(<ReviewHeader />, { commit: 'abc1234', readOnly: true });
  expect(screen.getByRole('button', { name: 'Submit round' })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Review actions' }));
  expect((await screen.findAllByRole('menuitem')).map((i) => i.textContent)).toEqual(['Close review', 'Mark all read', 'Delete review…']);
});

test('deleting a review leaves every review-scoped key behind', async () => {
  stubFetch({ 'DELETE api/reviews/r-1': { ok: true } });
  history.replaceState(null, '', '?project=app&review=r-1&file=a.js&thread=t-1&commit=abc1234&view=threads');
  const user = userEvent.setup();
  renderInReview(<ReviewHeader />);
  await user.click(screen.getByRole('button', { name: 'Review actions' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Delete review…' }));
  await user.click(screen.getByRole('button', { name: 'Delete' }));
  await waitFor(() => expect(parseRoute(location.search)).toEqual({ project: 'app' }));
});

test('a review that names an author shows the author’s session label; one without shows no Author text', () => {
  const worker = { sessionId: 's-w', project: 'app', worktree: null, label: 'Worker', status: 'idle', live: true, conductor: false, conducted: false, attached: false };
  const { unmount } = renderInReview(<ReviewHeader />, { review: review({ author: 's-w' }), sessions: [worker] });
  expect(screen.getByText('Author: Worker')).toBeTruthy();
  unmount();
  renderInReview(<ReviewHeader />, { review: review({ author: null }), sessions: [worker] });
  expect(screen.queryByText(/Author/)).toBeNull();
});

const rounds2 = [1, 2].map((n) => ({ n, headSha: String(n).repeat(40), baseSha: 'b'.repeat(40), createdAt: '', submittedAt: null }));
const menuItems = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: 'Review actions' }));
  return screen.findAllByRole('menuitem');
};

// Invariant: "Open head in code-git" opens the current round's head (not a viewed past round's), in cc's top frame.
test('the actions menu opens the current round\'s head in code-git', async () => {
  installBridge();
  installTop({ pathname: '/', search: '' });
  stubFetch({ 'GET api/integrations': { codeGit: { id: 'code-git' } } });
  const user = userEvent.setup();
  renderInReview(<ReviewHeader />, { review: review({ round: 2, recipient: null }), rounds: rounds2, round: 1, readOnly: true });
  const item = await waitFor(async () => {
    const found = (await menuItems(user)).find((i) => i.textContent === 'Open head in code-git');
    expect(found).toBeTruthy();
    return found!;
  });
  expect(item.tagName).toBe('A');
  expect(item.getAttribute('target')).toBe('_top');
  expect(item.getAttribute('href')).toBe(`/#plugin/code-git/?project=app&worktree=feature&commit=${'2'.repeat(40)}`);
});

test('without code-git the actions menu has no code-git item', async () => {
  for (const answer of [{ codeGit: null }, refusal('CONDUCTOR_UNAVAILABLE', 502)]) {
    installBridge();
    installTop();
    const net = stubFetch({ 'GET api/integrations': answer });
    const user = userEvent.setup();
    const { unmount } = renderInReview(<ReviewHeader />);
    await waitFor(() => expect(net.count('GET api/integrations')).toBe(1));
    await new Promise((r) => setTimeout(r, 0));
    expect((await menuItems(user)).map((i) => i.textContent)).not.toContain('Open head in code-git');
    unmount();
    resetCodeGit();
  }
});
