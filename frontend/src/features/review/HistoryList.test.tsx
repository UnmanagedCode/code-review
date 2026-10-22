import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { parseRoute } from '@/lib/route';
import type { Round } from '@/lib/types';
import { refusal, review } from '@/test/fixtures';
import { renderInReview } from '@/test/renderCtx';
import { stubFetch } from '@/test/stubFetch';
import type { ReviewCtx } from '@/state/reviewContext';
import { HistoryList } from './HistoryList';

const rounds = (n: number): Round[] => Array.from({ length: n }, (_, i) => ({ n: i + 1, headSha: `${i + 1}`.repeat(40), baseSha: 'b'.repeat(40), createdAt: '', submittedAt: null }));
const COMMITS = { commits: [{ sha: 'abc1234', short: 'abc1234', author: 'a', date: 'd', subject: 'first', merge: false }, { sha: 'def5678', short: 'def5678', author: 'a', date: 'd', subject: 'second', merge: false }] };
const show = (n: number, over: Partial<ReviewCtx> = {}, commits: unknown = COMMITS) => {
  const net = stubFetch({ 'GET api/reviews/r-1/commits': commits });
  return { net, ...renderInReview(<HistoryList />, { review: review({ kind: 'range', round: n }), rounds: rounds(n), ...over }) };
};
const nav = () => screen.getByRole('navigation', { name: 'History' });
const link = (name: RegExp) => within(nav()).getByRole('link', { name });
const current = () => within(nav()).getAllByRole('link').filter((a) => a.getAttribute('aria-current') === 'true');
const select = (name: string) => screen.getByRole('combobox', { name }) as HTMLSelectElement;
const compareButton = () => screen.queryByRole('button', { name: 'Compare rounds' });

// Invariant: the current round first, then the past rounds newest first; commits nest under the current round only.
test('lists the current round with its commits, then the past rounds newest first', async () => {
  show(3);
  await within(nav()).findByRole('link', { name: /abc1234/ });
  const top = within(nav()).getAllByRole('listitem').filter((li) => li.parentElement!.parentElement === nav());
  expect(top.map((li) => within(li).getAllByRole('link')[0].textContent)).toEqual(['Round 3 (current) · 3333333', 'Round 2 · 2222222', 'Round 1 · 1111111']);
  expect(within(top[0]).getAllByRole('link').map((a) => a.textContent)).toEqual(['Round 3 (current) · 3333333', 'abc1234 first', 'def5678 second']);
  expect(within(top[1]).getAllByRole('link')).toHaveLength(1);
});

// Invariant: aria-current marks the live review, the commit filter, or the viewed past round.
test.each([
  ['the live review', {}, /^Round 3 \(current\)/],
  ['a commit filter', { commit: 'def5678', readOnly: true }, /def5678/],
  ['a past round', { round: 1, readOnly: true }, /^Round 1 · /],
] as const)('marks %s as current', async (_what, over, want) => {
  show(3, over);
  await within(nav()).findByRole('link', { name: /abc1234/ });
  expect(current()).toEqual([link(want)]);
});

// Invariant: picking a past round views it, leaving any commit filter, comparison and file position; the tab stays.
test('picking a past round sets round and clears commit, compare and the file position, keeping view=history', async () => {
  history.replaceState(null, '', '?review=r-1&commit=abc1234&file=a.js&lines=3&side=new&thread=t-1&view=history');
  show(3, { commit: 'abc1234', readOnly: true });
  await userEvent.setup().click(link(/^Round 2 · /));
  expect(parseRoute(location.search)).toEqual({ review: 'r-1', round: '2', view: 'history' });
});

// Invariant: picking the current round returns to the live review.
test('picking the current round clears round, compare and commit', async () => {
  history.replaceState(null, '', '?review=r-1&round=1&file=a.js&view=history');
  show(3, { round: 1, readOnly: true });
  await userEvent.setup().click(link(/^Round 3 \(current\)/));
  expect(parseRoute(location.search)).toEqual({ review: 'r-1', view: 'history' });
});

// Invariant: commit= beats compare= beats round=, so a commit pick leaves a past view or a comparison.
test.each([
  ['a past round', '&round=1', { round: 1, readOnly: true }],
  ['a comparison', '&compare=1..3', { compare: { from: 1, to: 3 }, readOnly: true }],
] as const)('picking a commit from %s clears it and the file position', async (_what, q, over) => {
  history.replaceState(null, '', `?review=r-1${q}&file=a.js&lines=3&thread=t-1&view=history`);
  show(3, over);
  await userEvent.setup().click(await within(nav()).findByRole('link', { name: /def5678/ }));
  expect(parseRoute(location.search)).toEqual({ review: 'r-1', commit: 'def5678', view: 'history' });
});

// Invariant: Compare rounds starts on previous vs latest and leaves any round view, commit filter and file position.
test('Compare rounds navigates to the previous vs the current round, clearing round, commit and the file position', async () => {
  history.replaceState(null, '', '?review=r-1&round=1&commit=abc1234&file=a.js&lines=3&side=new&thread=t-1&view=history');
  show(3, { round: 1, readOnly: true });
  await userEvent.setup().click(compareButton()!);
  expect(parseRoute(location.search)).toEqual({ review: 'r-1', compare: '2..3', view: 'history' });
});

// Invariant: a comparison needs two rounds; there is no entry point with one.
test('no Compare rounds with one round', () => {
  show(1);
  expect(compareButton()).toBeNull();
  expect(screen.queryByRole('combobox')).toBeNull();
});

// Invariant: in a comparison From offers only rounds before To, and To only rounds after From; no entry is current.
test('in a comparison, From lists the rounds before To and To the rounds after From, the ends badged, none current', async () => {
  show(4, { compare: { from: 2, to: 3 }, readOnly: true });
  expect(compareButton()).toBeNull();
  expect([...select('From').options].map((o) => o.value)).toEqual(['2', '1']);
  expect([...select('To').options].map((o) => o.value)).toEqual(['4', '3']);
  expect([select('From').value, select('To').value]).toEqual(['2', '3']);
  expect(select('To').options[0].textContent).toContain('(current)');
  await within(nav()).findByRole('link', { name: /abc1234/ });
  expect(current()).toEqual([]);
  expect(within(link(/^Round 2 · /)).getByText('From')).toBeTruthy();
  expect(within(link(/^Round 3 · /)).getByText('To')).toBeTruthy();
  expect(within(link(/^Round 4 \(current\)/)).queryByText(/^(From|To)$/)).toBeNull();
});

// Invariant: changing either end navigates to the new pair and leaves the open file position.
test('changing From or To navigates to the new pair and clears the file position', async () => {
  history.replaceState(null, '', '?review=r-1&compare=2..3&file=a.js&lines=3&side=old&thread=t-1&view=history');
  const user = userEvent.setup();
  show(4, { compare: { from: 2, to: 3 }, readOnly: true });
  await user.selectOptions(select('From'), '1');
  expect(parseRoute(location.search)).toEqual({ review: 'r-1', compare: '1..3', view: 'history' });
  await user.selectOptions(select('To'), '4');
  expect(parseRoute(location.search)).toEqual({ review: 'r-1', compare: '2..4', view: 'history' });
});

// Invariant: a failed commits fetch says so and can be retried, rather than hiding the commits.
test('a failed commits fetch shows the error with Retry, which fetches again', async () => {
  const { net } = show(2, {}, () => refusal('SYSTEM_UNREACHABLE', 502));
  const retry = await screen.findByRole('button', { name: 'Retry' });
  expect(link(/^Round 2 \(current\)/)).toBeTruthy();
  await userEvent.setup().click(retry);
  await waitFor(() => expect(net.count('GET api/reviews/r-1/commits')).toBe(2));
  expect(await screen.findByRole('button', { name: 'Retry' })).toBeTruthy();
});
