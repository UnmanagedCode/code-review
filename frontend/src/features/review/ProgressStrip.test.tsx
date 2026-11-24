import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { parseRoute } from '@/lib/route';
import { review } from '@/test/fixtures';
import { renderInReview } from '@/test/renderCtx';
import { ProgressStrip } from './ProgressStrip';

const withStates = (threadStates: Partial<ReturnType<typeof review>['counts']['threadStates']>, over: Partial<ReturnType<typeof review>> = {}) =>
  review({
    counts: {
      files: 1, hunks: { pending: 3, accepted: 2, rejected: 1 }, threads: { open: 6, resolved: 0, outdated: 0 },
      threadStates: { awaitingHuman: 0, verifyResolution: 0, unsent: 0, awaitingAgent: 0, ...threadStates },
    },
    ...over,
  });

// Invariant: "need you" = awaiting-human + verify-resolution, "will be sent" = unsent, "waiting on agent" = awaiting-agent; never unread.
test('pill numbers are the thread-state counts, with need you summing the two agent-acted states', () => {
  renderInReview(<ProgressStrip />, { review: withStates({ awaitingHuman: 2, verifyResolution: 1, unsent: 4, awaitingAgent: 5 }, { unread: 99 }) });
  expect(screen.getByRole('link', { name: '3 threads need you' })).toBeTruthy();
  expect(screen.getByRole('link', { name: '4 threads will be sent' })).toBeTruthy();
  expect(screen.getByRole('link', { name: '5 threads waiting on agent' })).toBeTruthy();
});

// Invariant: before a round is delivered a thread reads "will be sent", never "waiting on agent"; after delivery it reads the latter.
test('unsent threads read "will be sent" and delivered ones "waiting on agent"', () => {
  const { unmount } = renderInReview(<ProgressStrip />, { review: withStates({ unsent: 2 }) });
  expect(screen.getByRole('link', { name: '2 threads will be sent' })).toBeTruthy();
  expect(screen.queryByRole('link', { name: /waiting on agent/ })).toBeNull();
  unmount();
  renderInReview(<ProgressStrip />, { review: withStates({ awaitingAgent: 2 }) });
  expect(screen.getByRole('link', { name: '2 threads waiting on agent' })).toBeTruthy();
  expect(screen.queryByRole('link', { name: /will be sent/ })).toBeNull();
});

test('a pill with a zero count is omitted', () => {
  renderInReview(<ProgressStrip />, { review: withStates({ awaitingHuman: 1 }) });
  expect(screen.getAllByRole('link', { name: /threads? (need you|will be sent|waiting on agent)$/ })).toHaveLength(1);
});

// Invariant: the bar's values are decided (accepted + rejected) out of all the round's hunks.
test('the progressbar reports decided out of total', () => {
  renderInReview(<ProgressStrip />, { review: withStates({ awaitingHuman: 1 }) });
  const bar = screen.getByRole('progressbar', { name: 'Hunks decided' });
  expect(bar.getAttribute('aria-valuenow')).toBe('3');
  expect(bar.getAttribute('aria-valuemax')).toBe('6');
  expect(screen.getByText(/3 of 6 decided/)).toBeTruthy();
});

// Invariant: each pill opens the Threads tab filtered to its group, as a pushed (Back-able) navigation.
test('each pill links to view=threads with its need group', async () => {
  history.replaceState(null, '', '?review=r-1&file=a.ts');
  renderInReview(<ProgressStrip />, { review: withStates({ awaitingHuman: 1, unsent: 1, awaitingAgent: 1 }) });
  const user = userEvent.setup();
  for (const [name, need] of [[/need you/, 'needs-you'], [/will be sent/, 'unsent'], [/waiting on agent/, 'waiting']] as const) {
    await user.click(screen.getByRole('link', { name }));
    expect(parseRoute(location.search), String(name)).toMatchObject({ view: 'threads', need });
  }
});

// Invariant: "k undecided" opens the overview with no file open.
test('"k undecided" opens the overview and leaves the open file', async () => {
  history.replaceState(null, '', '?review=r-1&file=a.ts&lines=3&view=threads');
  renderInReview(<ProgressStrip />, { review: withStates({ awaitingHuman: 1 }) });
  await userEvent.setup().click(screen.getByRole('link', { name: '3 undecided →' }));
  expect(parseRoute(location.search)).toEqual({ review: 'r-1', view: 'overview' });
});

test('the strip is absent in a past view', () => {
  renderInReview(<ProgressStrip />, { review: withStates({ awaitingHuman: 1 }), round: 1, readOnly: true });
  expect(screen.queryByRole('region', { name: 'Review progress' })).toBeNull();
});

// Invariant: an uncommitted review has no verdicts, so its strip has the thread pills and no hunk part.
test('an uncommitted review shows pills and no hunk progress', () => {
  const rv = withStates({ awaitingHuman: 1 }, { kind: 'uncommitted' });
  rv.counts.hunks = { total: 4 };
  renderInReview(<ProgressStrip />, { review: rv });
  const strip = screen.getByRole('region', { name: 'Review progress' });
  expect(within(strip).queryByRole('progressbar')).toBeNull();
  expect(within(strip).queryByText(/decided/)).toBeNull();
  expect(within(strip).getByRole('link', { name: '1 thread need you' })).toBeTruthy();
});
