import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { parseRoute } from '@/lib/route';
import type { Kind, Round } from '@/lib/types';
import { diffFile, fileState, guideView, review, threadDigest } from '@/test/fixtures';
import { renderInReview } from '@/test/renderCtx';
import { stubFetch } from '@/test/stubFetch';
import type { ReviewCtx } from '@/state/reviewContext';
import { ReviewPane } from './ReviewPane';

const rounds = (n: number): Round[] => Array.from({ length: n }, (_, i) => ({ n: i + 1, headSha: `${i + 1}`.repeat(40), baseSha: 'b'.repeat(40), createdAt: '', submittedAt: null }));
const show = (kind: Kind = 'range', over: Partial<ReviewCtx> = {}) => {
  stubFetch({ 'GET api/reviews/r-1/commits': { commits: [{ sha: 'abc1234', short: 'abc1234', author: 'a', date: 'd', subject: 's', merge: false }] } });
  return renderInReview(<ReviewPane />, { review: review({ kind, round: 2 }), rounds: rounds(2), ...over });
};
const paneTabs = () => within(screen.getByRole('tablist', { name: 'Review pane' })).getAllByRole('tab');
const text = (el: Element) => el.textContent!.trim();
const selected = () => text(paneTabs().find((t) => t.getAttribute('aria-selected') === 'true')!);

// Invariant: the top-level tabs are Files, Threads and History; History only where there are rounds to list.
test.each([
  ['range', ['Files', 'Threads', 'History']],
  ['commit', ['Files', 'Threads']],
  ['uncommitted', ['Files', 'Threads']],
] as const)('a %s review\'s pane tabs are %j', (kind, names) => {
  show(kind);
  expect(paneTabs().map(text)).toEqual(names);
});

// Invariant: the thread filter is a second tablist inside the Threads panel, not part of the pane's tabs.
test('the Threads panel holds the "Thread filter" tablist, apart from the pane\'s tabs', async () => {
  show();
  await userEvent.setup().click(screen.getByRole('tab', { name: 'Threads' }));
  const filter = within(screen.getByRole('tabpanel', { name: 'Threads' })).getByRole('tablist', { name: 'Thread filter' });
  expect(within(filter).getAllByRole('tab').map(text)).toEqual(['This file', 'All 0', 'Outdated 0', 'Review 0']);
  expect(paneTabs().some((t) => /This file|All|Outdated|Review/.test(t.textContent!))).toBe(false);
});

// Invariant: the Threads tab carries the open-thread count of what is shown (the viewed round's in a past view), and none at zero.
test('the Threads tab shows the open-thread count of what is shown', () => {
  const counts = (open: number) => ({ open, resolved: 0, outdated: 0 });
  const { unmount } = show('range', { threadCounts: counts(3) });
  expect(text(screen.getByRole('tab', { name: /^Threads/ }))).toBe('Threads 3');
  unmount();
  const past = show('range', { threadCounts: counts(1), round: 1, readOnly: true });
  expect(text(screen.getByRole('tab', { name: /^Threads/ }))).toBe('Threads 1');
  past.unmount();
  show('range', { threadCounts: counts(0) });
  expect(text(screen.getByRole('tab', { name: /^Threads/ }))).toBe('Threads');
});

// Invariant: the Threads tab's badge, the All list under the default filters and the review's open-thread count are one number.
test('the Threads badge equals the All count and the review\'s open threads', async () => {
  const open = [threadDigest({ id: 't-1' }), threadDigest({ id: 't-2', state: 'unsent' }), threadDigest({ id: 't-r', anchor: { kind: 'review', round: 1 } })];
  const summary = review({ round: 2, counts: { ...review().counts, threads: { open: 3, resolved: 4, outdated: 0 } } });
  show('range', { review: summary, threadCounts: summary.counts.threads, openThreads: open });
  expect(text(screen.getByRole('tab', { name: /^Threads/ }))).toBe('Threads 3');
  await userEvent.setup().click(screen.getByRole('tab', { name: /^Threads/ }));
  expect(text(screen.getByRole('tab', { name: /^All/ }))).toBe('All 3');
});

// Invariant: while the pane shows Files (the Threads panel stays mounted, hidden) or the status filter is Open, no per-file diff is fetched for the thread list.
test('no per-file diff is fetched while the pane shows Files, nor while the status is Open', async () => {
  const net = stubFetch({ 'GET api/reviews/r-1/commits': { commits: [] }, 'GET api/reviews/r-1/diff': { review: review(), files: [diffFile({ threads: [] })] } });
  const files = [fileState({ threads: { open: 1, resolved: 1, outdated: 0 } })];
  renderInReview(<ReviewPane />, { review: review({ kind: 'range', round: 2 }), rounds: rounds(2), files, openThreads: [threadDigest()] });
  await act(async () => {});
  expect(net.count('GET api/reviews/r-1/diff')).toBe(0);
  const user = userEvent.setup();
  await user.click(screen.getByRole('tab', { name: /^Threads/ }));
  await act(async () => {});
  expect(net.count('GET api/reviews/r-1/diff')).toBe(0);
  await user.selectOptions(screen.getByLabelText('Status'), 'resolved');
  await waitFor(() => expect(net.count('GET api/reviews/r-1/diff')).toBe(1));
});

// Invariant: the tab is the route's view; History falls back to Files where there is none.
test.each([
  ['', 'range', 'Files'],
  ['&view=threads', 'range', 'Threads'],
  ['&view=history', 'range', 'History'],
  ['&view=history', 'uncommitted', 'Files'],
  ['&view=new', 'range', 'Files'],
] as const)('?review=r-1%s on a %s review selects %s', (q, kind, tab) => {
  history.replaceState(null, '', `?review=r-1${q}`);
  show(kind);
  expect(selected()).toBe(tab);
});

// Invariant: a tab click replaces the history entry, so Back skips tab switches; Files clears view=.
test('choosing a tab replaces the history entry', async () => {
  history.replaceState(null, '', '?review=r-1&file=a.js');
  show();
  const push = vi.spyOn(history, 'pushState');
  const replace = vi.spyOn(history, 'replaceState');
  const user = userEvent.setup();
  await user.click(screen.getByRole('tab', { name: 'History' }));
  expect(parseRoute(location.search)).toEqual({ review: 'r-1', file: 'a.js', view: 'history' });
  await user.click(screen.getByRole('tab', { name: 'Files' }));
  expect(parseRoute(location.search)).toEqual({ review: 'r-1', file: 'a.js' });
  expect(replace).toHaveBeenCalledTimes(2);
  expect(push).not.toHaveBeenCalled();
});

// Invariant: inactive panels are hidden: out of the accessibility tree (and so out of role queries).
test('only the active panel is a visible tabpanel', async () => {
  show();
  expect(screen.getAllByRole('tabpanel').map((p) => p.getAttribute('aria-labelledby'))).toEqual([paneTabs()[0].id]);
  await userEvent.setup().click(screen.getByRole('tab', { name: 'History' }));
  expect(screen.getAllByRole('tabpanel')).toEqual([screen.getByRole('tabpanel', { name: 'History' })]);
  expect(screen.queryByRole('navigation', { name: 'Files' })).toBeNull();
});

// Invariant: panels stay mounted, so the thread filter's choice survives a trip to another tab.
test('the thread filter keeps its tab across pane tab switches', async () => {
  show();
  const user = userEvent.setup();
  await user.click(screen.getByRole('tab', { name: 'Threads' }));
  await user.click(screen.getByRole('tab', { name: /^Outdated/ }));
  await user.click(screen.getByRole('tab', { name: 'Files' }));
  await user.click(screen.getByRole('tab', { name: 'Threads' }));
  expect(screen.getByRole('tab', { name: /^Outdated/ }).getAttribute('aria-selected')).toBe('true');
});

const outsideAndBefore = (el: HTMLElement) => {
  expect(el.closest('[role="tabpanel"]')).toBeNull();
  expect(el.compareDocumentPosition(screen.getByRole('tablist', { name: 'Review pane' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
};

// Invariant: the header, the banners and the refresh controls sit above the tabs, on every tab.
test.each([
  ['a round view\'s banner', { round: 1, readOnly: true }, 'Back to current round'],
  ['the refresh cue', { review: review({ round: 2, headMoved: true }) }, 'Refresh'],
] as const)('the Reviews link and %s render outside every tabpanel, before the tabs, on each tab', async (_what, over, button) => {
  show('range', over);
  const user = userEvent.setup();
  for (const tab of ['Files', 'Threads', 'History']) {
    await user.click(screen.getByRole('tab', { name: tab }));
    outsideAndBefore(screen.getByRole('link', { name: 'Reviews' }));
    outsideAndBefore(screen.getByRole('button', { name: button }));
  }
});

// Invariant: the Guided tab sits between Files and Threads wherever a live committed review has a guide with groups or an offer.
test('a range or commit review with a guide shows Files, Guided, Threads (, History)', () => {
  const guide = guideView();
  const a = show('range', { guide });
  expect(paneTabs().map(text)).toEqual(['Files', 'Guided', 'Threads', 'History']);
  a.unmount();
  show('commit', { guide });
  expect(paneTabs().map(text)).toEqual(['Files', 'Guided', 'Threads']);
});

// Invariant: an uncommitted review, a guide with nothing in it and no guide all hide the tab.
test('no Guided tab for an uncommitted review, an empty guide, or no guide', () => {
  const a = show('uncommitted', { guide: guideView() });
  expect(paneTabs().map(text)).toEqual(['Files', 'Threads']);
  a.unmount();
  const b = show('range', { guide: guideView({ groups: [] }) });
  expect(paneTabs().map(text)).toEqual(['Files', 'Threads', 'History']);
  b.unmount();
  show('range', { guide: null });
  expect(paneTabs().map(text)).toEqual(['Files', 'Threads', 'History']);
});

// Invariant: a round view, a comparison and the commit filter have no Guided tab, and view=guided there shows Files without rewriting the URL.
test.each([
  ['round view', { round: 1, readOnly: true }],
  ['comparison', { compare: { from: 1, to: 2 }, readOnly: true }],
  ['commit filter', { commit: 'abc1234', readOnly: true }],
] as const)('%s: no Guided tab; view=guided selects Files and leaves the URL alone', (_name, over) => {
  history.replaceState(null, '', '?review=r-1&view=guided');
  show('range', { guide: guideView(), ...over });
  expect(paneTabs().map(text)).not.toContain('Guided');
  expect(selected()).toBe('Files');
  expect(location.search).toBe('?review=r-1&view=guided');
});

test('view=guided selects Guided, and choosing a tab writes view with replace', async () => {
  history.replaceState(null, '', '?review=r-1&view=guided');
  show('range', { guide: guideView() });
  expect(selected()).toBe('Guided');
  const before = history.length;
  await userEvent.setup().click(screen.getByRole('tab', { name: 'Files' }));
  expect(parseRoute(location.search)).toEqual({ review: 'r-1' });
  expect(history.length).toBe(before);
});
