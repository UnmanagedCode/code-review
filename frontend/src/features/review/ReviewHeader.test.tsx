import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { parseRoute } from '@/lib/route';
import { installBridge } from '@/test/fakeBridge';
import { review } from '@/test/fixtures';
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

test('a review that names an author shows the author’s session title; one without shows no Author text', () => {
  const worker = { sessionId: 's-w', project: 'app', worktree: null, title: 'Worker', status: 'idle', live: true, conductor: false, conducted: false, attached: false };
  const { unmount } = renderInReview(<ReviewHeader />, { review: review({ author: 's-w' }), sessions: [worker] });
  expect(screen.getByText('Author: Worker')).toBeTruthy();
  unmount();
  renderInReview(<ReviewHeader />, { review: review({ author: null }), sessions: [worker] });
  expect(screen.queryByText(/Author/)).toBeNull();
});
