import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { parseRoute } from '@/lib/route';
import type { ThreadDigest, ThreadState } from '@/lib/types';
import { visitBaseline } from '@/state/lastViewed';
import { activityItem, agent, fileState, guideGroup, groupAnchor, guideView, linesAnchor, review, threadDigest } from '@/test/fixtures';
import { ReviewProvider } from '@/test/reviewProvider';
import { ctxValue, renderInReview } from '@/test/renderCtx';
import { OverviewPage } from './OverviewPage';

const digest = (id: string, state: ThreadState, over: Partial<ThreadDigest> = {}) => threadDigest({ id, state, ...over });
const region = (name: string) => screen.getByRole('region', { name: new RegExp(`^${name}`) });
const pending = { pending: 2, accepted: 0, rejected: 0 };

// Invariant: Needs you lists exactly the awaiting-human and verify-resolution threads, in place order, each linking to its place.
test('Needs you lists the two agent-acted states in place order and a row opens its thread', async () => {
  const openThreads = [
    digest('t-3', 'awaiting-human', { anchor: linesAnchor({ file: 'src/b.ts', startLine: 1 }) }),
    digest('t-1', 'verify-resolution', { anchor: linesAnchor({ file: 'src/a.ts', startLine: 9 }) }),
    digest('t-2', 'unsent'),
    digest('t-4', 'awaiting-agent'),
  ];
  renderInReview(<OverviewPage />, { openThreads, files: [fileState({ path: 'src/a.ts' }), fileState({ path: 'src/b.ts' })] });
  const rows = within(region('Needs you')).getAllByRole('link');
  expect(rows.map((r) => r.getAttribute('href'))).toEqual(['?file=src%2Fa.ts&side=new&thread=t-1', '?file=src%2Fb.ts&side=new&thread=t-3']);
  await userEvent.setup().click(rows[0]);
  expect(parseRoute(location.search)).toEqual({ file: 'src/a.ts', side: 'new', thread: 't-1' });
});

test('with nothing for the human, Needs you says so', () => {
  renderInReview(<OverviewPage />, { openThreads: [digest('t-2', 'unsent')] });
  expect(within(region('Needs you')).getByText('Nothing needs you right now')).toBeTruthy();
});

// Invariant: threads not yet delivered read "Will be sent"; delivered ones read "Waiting on agent". Neither is in Needs you.
test('Your threads splits unsent from delivered threads', () => {
  const openThreads = [digest('t-1', 'unsent', { first: { author: { kind: 'human' }, at: '2026-01-01T00:00:00Z', preview: 'my question' } }), digest('t-2', 'awaiting-agent')];
  renderInReview(<OverviewPage />, { openThreads });
  const card = region('Your threads');
  expect(within(card).getByRole('heading', { name: /Will be sent/ }).closest('div')!.textContent).toContain('my question');
  expect(within(card).getByRole('heading', { name: /Waiting on agent/ })).toBeTruthy();
  expect(within(region('Needs you')).queryAllByRole('link')).toHaveLength(0);
});

test('with no threads of the human\'s own the card says so', () => {
  renderInReview(<OverviewPage />, { openThreads: [digest('t-1', 'awaiting-human')] });
  expect(within(region('Your threads')).getByText('No threads of yours are open')).toBeTruthy();
});

// Invariant: the feed lists agent events newer than the marker the visit started from, and a later marker move does not shrink it.
test('the feed shows only events after the visit baseline and keeps them when lastViewedSeq advances', () => {
  const activity = [activityItem({ seq: 9, event: 'resolved' }), activityItem({ seq: 7 }), activityItem({ seq: 3 })];
  const ui = (lastViewedSeq: number) => <ReviewProvider value={ctxValue({ review: review({ seq: 9, lastViewedSeq }), activity })}><OverviewPage /></ReviewProvider>;
  const { rerender } = render(ui(5));
  const feed = () => within(region('What the agent did — since you last looked')).getAllByRole('listitem');
  expect(feed()).toHaveLength(2);
  expect(visitBaseline(review({ lastViewedSeq: 5 }))).toBe(5);
  // The viewed write moves the marker to 9 within the same visit: the baseline stays pinned at 5.
  rerender(ui(9));
  expect(feed()).toHaveLength(2);
});

test('an empty feed says nothing is new', () => {
  renderInReview(<OverviewPage />, { review: review({ seq: 3, lastViewedSeq: 3 }), activity: [activityItem({ seq: 2 })] });
  expect(screen.getByText('Nothing new since you last looked')).toBeTruthy();
});

// Invariant: the round line follows `unsent` and the newest delivered round submission.
test('the round status says not sent yet, or when and to whom it was sent', () => {
  const sub = { id: 's1', kind: 'round' as const, status: 'delivered' as const, code: null, round: 1, recipient: 's-author', text: '', deliveredAt: '2026-01-01T00:00:00Z' };
  const sessions = [{ sessionId: 's-author', project: 'app', worktree: 'feature', label: 'Author one', status: 'idle', live: true, conductor: false, conducted: false, attached: true }];
  const { unmount } = renderInReview(<OverviewPage />, { review: review({ unsent: true }), sessions });
  expect(screen.getByText('Round 1 not sent yet to Author one')).toBeTruthy();
  unmount();
  renderInReview(<OverviewPage />, { review: review({ unsent: false }), sessions, submissions: [sub] });
  expect(screen.getByText(/^Round 1 sent to Author one · /)).toBeTruthy();
});

test('an event names the agent, the verb and the place', () => {
  const guide = guideView({ groups: [guideGroup({ id: 'g1', title: 'Rename' })] });
  renderInReview(<OverviewPage />, {
    review: review({ seq: 9, lastViewedSeq: 0 }), guide, sessions: [{ sessionId: 's-author', project: 'app', worktree: null, label: 'Ada', status: 'idle', live: true, conductor: false, conducted: false, attached: true }],
    activity: [activityItem({ seq: 4, event: 'proposed-resolution', actor: agent('s-author', 'author'), thread: { id: 't-1', kind: 'comment', severity: null, anchor: groupAnchor({ groupId: 'g1' }) } })],
  });
  const item = within(region('What the agent did — since you last looked')).getAllByRole('listitem')[0];
  expect(item.textContent).toContain('Ada proposed resolving Group: Rename');
});

// Invariant: reviews with verdicts show per-file decided counts; uncommitted ones hide the Hunks card and the next-hunk button.
test('uncommitted reviews hide the Hunks card and the next-undecided button', () => {
  const rv = review({ kind: 'uncommitted' });
  rv.counts.hunks = { total: 3 };
  renderInReview(<OverviewPage />, { review: rv, files: [fileState({ verdicts: null })] });
  expect(screen.queryByRole('region', { name: 'Hunks' })).toBeNull();
  expect(screen.queryByRole('button', { name: /Review next undecided hunk/ })).toBeNull();
});

test('the Hunks card lists each file decided out of its hunks, in tree order', () => {
  renderInReview(<OverviewPage />, {
    review: review({ counts: { ...review().counts, hunks: { pending: 1, accepted: 2, rejected: 0 } } }),
    files: [fileState({ path: 'a.ts', hunks: 1, verdicts: { pending: 1, accepted: 0, rejected: 0 } }), fileState({ path: 'dir/b.ts', hunks: 2, verdicts: { pending: 0, accepted: 2, rejected: 0 } })],
  });
  const rows = within(region('Hunks')).getAllByRole('link').map((r) => r.textContent);
  expect(rows).toEqual(['dir/b.ts2/2', 'a.ts0/1']);
});

// Invariant: "Review next undecided hunk" opens the first file in tree order with a pending hunk, landing on that file's first pending hunk (`hunk=undecided`).
test('the next-undecided button opens firstUndecided at its first pending hunk', async () => {
  const files = [
    fileState({ path: 'a.ts', verdicts: pending }),
    fileState({ path: 'dir/b.ts', verdicts: { pending: 1, accepted: 0, rejected: 0 } }),
  ];
  renderInReview(<OverviewPage />, { review: review({ counts: { ...review().counts, hunks: { pending: 3, accepted: 0, rejected: 0 } } }), files });
  const button = screen.getByRole('button', { name: /Review next undecided hunk/ });
  expect(button.textContent).toContain('dir/b.ts · 1 undecided');
  await userEvent.setup().click(button);
  expect(parseRoute(location.search)).toEqual({ file: 'dir/b.ts', hunk: 'undecided' });
});

test('with every hunk decided the button gives way to text', () => {
  renderInReview(<OverviewPage />, { review: review({ counts: { ...review().counts, hunks: { pending: 0, accepted: 2, rejected: 0 } } }), files: [fileState({ verdicts: { pending: 0, accepted: 2, rejected: 0 } })] });
  expect(screen.queryByRole('button', { name: /Review next undecided hunk/ })).toBeNull();
  expect(screen.getByText('All hunks decided')).toBeTruthy();
});

// Invariant: the sent line names the delivered submission's own recipient, not the review's current one.
test('the sent line names the submission\'s recipient', () => {
  const sub = { id: 's1', kind: 'round' as const, status: 'delivered' as const, code: null, round: 1, recipient: 's-old', text: '', deliveredAt: '2026-01-01T00:00:00Z' };
  const session = (sessionId: string, label: string) => ({ sessionId, project: 'app', worktree: 'feature', label, status: 'idle', live: true, conductor: false, conducted: false, attached: true });
  renderInReview(<OverviewPage />, { review: review({ unsent: false, recipient: 's-new' }), sessions: [session('s-old', 'Old agent'), session('s-new', 'New agent')], submissions: [sub] });
  expect(screen.getByText(/^Round 1 sent to Old agent · /)).toBeTruthy();
});

// Invariant: while the diff is unreadable, rows for file and line threads are not links (their file would only error) and say so;
// review and group rows stay links.
test('with an unreadable snapshot file and line rows are not links, review and group rows are', () => {
  const openThreads = [
    digest('t-1', 'awaiting-human', { anchor: linesAnchor({ file: 'src/a.ts' }) }),
    digest('t-2', 'awaiting-human', { anchor: { kind: 'file', file: 'src/a.ts', round: 1 } }),
    digest('t-3', 'awaiting-human', { anchor: { kind: 'review', round: 1 } }),
    digest('t-4', 'awaiting-human', { anchor: groupAnchor() }),
  ];
  renderInReview(<OverviewPage />, { review: review({ snapshotError: 'CHECKOUT_GONE' }), openThreads });
  const card = region('Needs you');
  expect(within(card).getAllByRole('link')).toHaveLength(2);
  expect(within(card).getAllByText('diff unavailable')).toHaveLength(2);
});

test('with an unreadable snapshot the feed\'s file and line items are not links, review and group items are', () => {
  const on = (seq: number, anchor: ReturnType<typeof linesAnchor> | { kind: 'file'; file: string; round: number } | { kind: 'review'; round: number } | ReturnType<typeof groupAnchor>) =>
    activityItem({ seq, thread: { id: `t-${seq}`, kind: 'comment', severity: null, anchor } });
  renderInReview(<OverviewPage />, {
    review: review({ snapshotError: 'CHECKOUT_GONE', seq: 9, lastViewedSeq: 0 }),
    activity: [on(1, linesAnchor()), on(2, { kind: 'file', file: 'src/a.ts', round: 1 }), on(3, { kind: 'review', round: 1 }), on(4, groupAnchor())],
  });
  const feed = region('What the agent did — since you last looked');
  expect(within(feed).getAllByRole('link')).toHaveLength(2);
  expect(within(feed).getAllByText(/diff unavailable/)).toHaveLength(2);
});
