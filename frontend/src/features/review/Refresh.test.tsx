import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { review } from '@/test/fixtures';
import { renderInReview } from '@/test/renderCtx';
import { stubFetch } from '@/test/stubFetch';
import { RefreshControls } from './RefreshControls';

test('the banner appears only for a range review whose HEAD moved', () => {
  const { unmount } = renderInReview(<RefreshControls />, { review: review({ headMoved: false }) });
  expect(screen.queryByText(/HEAD moved/)).toBeNull();
  unmount();
  renderInReview(<RefreshControls />, { review: review({ headMoved: true }) });
  expect(screen.getByText(/HEAD moved/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy();
});

test('commit reviews have no refresh control', () => {
  renderInReview(<RefreshControls />, { review: review({ kind: 'commit', headMoved: true }) });
  expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull();
});

test('uncommitted reviews get a Refresh button without a banner', () => {
  renderInReview(<RefreshControls />, { review: review({ kind: 'uncommitted' }) });
  expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy();
  expect(screen.queryByText(/HEAD moved/)).toBeNull();
});

test('the outcome lists hunks kept/reset/new and threads moved/drifted/outdated/dropped, then refetches', async () => {
  stubFetch({ 'POST api/reviews/r-1/refresh': { unchanged: false, round: 2, hunks: { kept: 3, reset: 1, new: 2 }, threads: { moved: 4, drifted: 1, outdated: 2, dropped: 0 } } });
  const { value } = renderInReview(<RefreshControls />, { review: review({ headMoved: true }) });
  await userEvent.setup().click(screen.getByRole('button', { name: 'Refresh' }));
  const report = await screen.findByLabelText('Refresh result');
  expect(report.textContent).toContain('Round 2: hunks 3 kept, 1 reset, 2 new; threads 4 moved, 1 drifted, 2 outdated, 0 dropped');
  await waitFor(() => expect(value.reload).toHaveBeenCalled());
  await userEvent.setup().click(screen.getByRole('button', { name: 'Dismiss' }));
  expect(screen.queryByLabelText('Refresh result')).toBeNull();
});

test('an unchanged refresh says so and names the round', async () => {
  stubFetch({ 'POST api/reviews/r-1/refresh': { unchanged: true, round: 1 } });
  renderInReview(<RefreshControls />, { review: review({ kind: 'uncommitted' }) });
  await userEvent.setup().click(screen.getByRole('button', { name: 'Refresh' }));
  expect((await screen.findByLabelText('Refresh result')).textContent).toContain('No changes; still round 1');
});

test('a past-round view has no refresh control, even with HEAD moved', () => {
  renderInReview(<RefreshControls />, { review: review({ headMoved: true }), round: 1, readOnly: true });
  expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull();
});
