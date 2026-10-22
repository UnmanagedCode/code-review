import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { parseRoute } from '@/lib/route';
import type { Kind, Round } from '@/lib/types';
import { review } from '@/test/fixtures';
import { renderInReview } from '@/test/renderCtx';
import { stubFetch } from '@/test/stubFetch';
import type { ReviewCtx } from '@/state/reviewContext';
import { ReviewPane } from './ReviewPane';
import { scopeLabel } from './ScopeIndicator';

const rounds = (n: number): Round[] => Array.from({ length: n }, (_, i) => ({ n: i + 1, headSha: `${i + 1}`.repeat(40), baseSha: 'b'.repeat(40), createdAt: '', submittedAt: null }));
const ctx = (kind: Kind, over: Partial<ReviewCtx> = {}) =>
  ({ review: review({ kind, round: 3, headSha: 'c'.repeat(40) }), rounds: rounds(3), round: undefined, compare: undefined, commit: undefined, ...over });

// Invariant: one line names what the diff and threads show.
test.each([
  ['a live range review', ctx('range'), 'Round 3 · 3333333'],
  ['a commit filter', ctx('range', { commit: 'abcdef1234' }), 'Round 3 · commit abcdef1'],
  ['a past round', ctx('range', { round: 1 }), 'Round 1 · 1111111 · read-only'],
  ['a comparison', ctx('range', { compare: { from: 1, to: 3 } }), 'Round 1 → 3 · read-only'],
  ['a commit review', ctx('commit'), 'Commit ccccccc'],
  ['an uncommitted review', ctx('uncommitted'), 'Round 3 · working tree'],
] as const)('%s reads "%s"', (_what, value, label) => {
  expect(scopeLabel(value)).toBe(label);
});

const show = (kind: Kind) => {
  stubFetch({ 'GET api/reviews/r-1/commits': { commits: [] } });
  return renderInReview(<ReviewPane />, { review: review({ kind, round: 3 }), rounds: rounds(3) });
};
const indicator = () => screen.getByRole('button', { name: 'Round 3 · 3333333 — show history' });

// Invariant: the scope line stays in view whichever tab is open.
test('the scope indicator is visible on every tab', async () => {
  show('range');
  const user = userEvent.setup();
  for (const tab of ['Files', 'Threads', 'History']) {
    await user.click(screen.getByRole('tab', { name: tab }));
    expect(indicator().closest('[role="tabpanel"]'), tab).toBeNull();
  }
});

// Invariant: on a range review the line opens History and moves focus to its tab.
test('clicking the scope indicator opens History and focuses its tab', async () => {
  history.replaceState(null, '', '?review=r-1&file=a.js');
  show('range');
  await userEvent.setup().click(indicator());
  expect(parseRoute(location.search)).toEqual({ review: 'r-1', file: 'a.js', view: 'history' });
  const tab = screen.getByRole('tab', { name: 'History' });
  await waitFor(() => expect(tab.getAttribute('aria-selected')).toBe('true'));
  expect(document.activeElement).toBe(tab);
});

// Invariant: without History the scope is plain text, not a control.
test.each(['commit', 'uncommitted'] as const)('on a %s review the scope indicator is not a button', (kind) => {
  show(kind);
  expect(screen.queryByRole('button', { name: /show history/ })).toBeNull();
  expect(screen.getByText(kind === 'commit' ? /^Commit / : 'Round 3 · working tree')).toBeTruthy();
});
