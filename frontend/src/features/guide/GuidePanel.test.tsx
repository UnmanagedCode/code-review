import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { parseRoute } from '@/lib/route';
import { guideGroup, guideView } from '@/test/fixtures';
import { renderInReview } from '@/test/renderCtx';
import { sampleGuide } from '@/test/guideWorld';
import { GuidePanel } from './GuidePanel';

const steps = () => within(screen.getByRole('navigation', { name: 'Steps' })).getAllByRole('button');
const current = () => steps().find((b) => b.getAttribute('aria-current') === 'step');

test('steps are numbered in order with their titles and verdict badges; aria-current sits on the first step when none is routed', () => {
  // Invariant: the list is the guide's reading order, each step shows its verdict, and the walk starts at step 1.
  renderInReview(<GuidePanel />, { guide: sampleGuide({}, { verdict: 'accepted' }) });
  expect(steps().map((b) => b.textContent)).toEqual(['1Wire it upaccepted', '2Tidypending', '3Other changes0/1 decided']);
  expect(current()?.textContent).toContain('Wire it up');
  expect(screen.getByText('Step 1 of 3 · 1 accepted · 0 rejected')).toBeTruthy();
});

test('aria-current follows the routed step', () => {
  history.replaceState(null, '', '?review=r-1&view=guided&step=g2');
  renderInReview(<GuidePanel />, { guide: sampleGuide() });
  expect(current()?.textContent).toContain('Tidy');
  expect(screen.getByText(/^Step 2 of 3/)).toBeTruthy();
});

test('an unread group shows its unread count', () => {
  renderInReview(<GuidePanel />, { guide: sampleGuide({}, { unread: 2 }) });
  expect(within(steps()[0]).getByText('2 unread')).toBeTruthy();
});

test('a step click sets step with a push and keeps view', async () => {
  // Invariant: step moves add a history entry (Back returns to the previous step) and the pane tab stays.
  history.replaceState(null, '', '?review=r-1&view=guided');
  renderInReview(<GuidePanel />, { guide: sampleGuide() });
  const before = history.length;
  await userEvent.setup().click(steps()[1]);
  expect(parseRoute(location.search)).toEqual({ review: 'r-1', view: 'guided', step: 'g2' });
  expect(history.length).toBe(before + 1);
});

test('retired groups are listed with their round and reason, and open their own step', async () => {
  history.replaceState(null, '', '?review=r-1&view=guided');
  renderInReview(<GuidePanel />, { guide: sampleGuide({ retired: [{ id: 'g7', title: 'Old plan', retiredIn: 2, reason: 'reproposal' }] }) });
  const retired = screen.getByRole('region', { name: 'Retired groups' });
  expect(within(retired).getByText('round 2 · re-proposal')).toBeTruthy();
  await userEvent.setup().click(within(retired).getByRole('button', { name: /Old plan/ }));
  expect(parseRoute(location.search)).toEqual({ review: 'r-1', view: 'guided', step: 'g7' });
});

test('with no steps it says so', () => {
  renderInReview(<GuidePanel />, { guide: guideView({ groups: [], ungrouped: [] }) });
  expect(screen.getByText('No groups for this round')).toBeTruthy();
});

test('a title with markup is shown as literal text', () => {
  // Invariant: group titles are text children, never markup.
  renderInReview(<GuidePanel />, { guide: guideView({ groups: [guideGroup({ title: '<img src=x onerror=alert(1)>' })] }) });
  expect(steps()[0].textContent).toContain('<img src=x onerror=alert(1)>');
  expect(document.querySelector('img')).toBeNull();
});

test.each([
  ['noGroups', { offered: true, noGroups: true, droppedGroups: 0, newUngrouped: 0 }, 'No groups yet — ask s-author to group this round'],
  ['droppedGroups', { offered: true, noGroups: false, droppedGroups: 2, newUngrouped: 0 }, 'A refresh dropped 2 groups since the last proposal'],
  ['newUngrouped', { offered: true, noGroups: false, droppedGroups: 0, newUngrouped: 3 }, '3 new hunks are in no group'],
])('Guide me is offered with the %s reason', (_flag, guideMe, reason) => {
  // Invariant: the button and its reason show only when the backend offers Guide me, with the flag that explains the offer.
  renderInReview(<GuidePanel />, { guide: sampleGuide({ guideMe }) });
  expect(screen.getByRole('button', { name: 'Guide me' })).toBeTruthy();
  expect(screen.getByText(reason)).toBeTruthy();
});

test('Guide me is hidden when not offered, and on a read-only review', () => {
  const a = renderInReview(<GuidePanel />, { guide: sampleGuide() });
  expect(screen.queryByRole('button', { name: 'Guide me' })).toBeNull();
  a.unmount();
  renderInReview(<GuidePanel />, { guide: sampleGuide({ guideMe: { offered: true, noGroups: false, droppedGroups: 1, newUngrouped: 0 } }), readOnly: true });
  expect(screen.queryByRole('button', { name: 'Guide me' })).toBeNull();
});
