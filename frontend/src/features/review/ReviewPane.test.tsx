import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { parseRoute } from '@/lib/route';
import type { Kind, Round } from '@/lib/types';
import { review } from '@/test/fixtures';
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

// Invariant: the Threads tab carries the unread count, except in a past view.
test('the Threads tab shows the unread badge on the live review only', () => {
  const { unmount } = show('range', { review: review({ round: 2, unread: 3 }) });
  expect(text(screen.getByRole('tab', { name: /^Threads/ }))).toBe('Threads 3');
  unmount();
  show('range', { review: review({ round: 2, unread: 3 }), round: 1, readOnly: true });
  expect(text(screen.getByRole('tab', { name: /^Threads/ }))).toBe('Threads');
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
