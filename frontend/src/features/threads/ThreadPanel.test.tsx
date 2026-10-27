import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { agent, diffFile, fileState, HUMAN, message, review, thread, linesAnchor } from '@/test/fixtures';
import { parseRoute } from '@/lib/route';
import { ctxValue } from '@/test/renderCtx';
import { stubFetch } from '@/test/stubFetch';
import type { ComparedThread, Thread, UnplacedThread } from '@/lib/types';
import { ReviewProvider } from '@/state/reviewContext';
import { ThreadPanel } from './ThreadPanel';

test('the All list refreshes when the review reloads, even with no file open', async () => {
  let threads = [thread({ id: 't-1' })];
  const net = stubFetch({ 'GET api/reviews/r-1/diff': () => ({ review: review(), files: [diffFile({ threads, sig: threads.length === 1 ? 's1' : 's2' })] }) });
  const ui = (files: ReturnType<typeof fileState>[]) => <ReviewProvider value={ctxValue({ files, fileDiff: { file: undefined } as never })}><ThreadPanel /></ReviewProvider>;
  const { rerender } = render(ui([fileState({ sig: 's1', threads: { open: 1, resolved: 0, outdated: 0 } })]));
  await userEvent.setup().click(screen.getByRole('tab', { name: /^All/ }));
  expect(await screen.findAllByRole('article')).toHaveLength(1);
  threads = [thread({ id: 't-1' }), thread({ id: 't-2' })];
  rerender(ui([fileState({ sig: 's2', threads: { open: 2, resolved: 0, outdated: 0 } })]));
  await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(2));
  expect(net.count('GET api/reviews/r-1/diff')).toBe(2);
});

// Invariant: Next unread focuses the thread by route (file, side, thread) and sets no `lines=` row wash.
test('"Next unread" focuses the first unread thread, which posts read {threadId}', async () => {
  history.replaceState(null, '', '?review=r-1&lines=9');
  const unread = thread({ id: 't-7', unread: 1 });
  const net = stubFetch({
    'GET api/reviews/r-1/diff': { review: review(), files: [diffFile({ threads: [thread({ id: 't-1' }), unread] })] },
    'POST api/reviews/r-1/read': { review: review() },
  });
  const files = [fileState({ threads: { open: 2, resolved: 0, outdated: 0 } })];
  const value = ctxValue({ files, fileDiff: { file: undefined } as never });
  const user = userEvent.setup();
  render(<ReviewProvider value={value}><ThreadPanel /></ReviewProvider>);
  await user.click(screen.getByRole('tab', { name: /^All/ }));
  await waitFor(() => expect((screen.getByRole('button', { name: 'Next unread' }) as HTMLButtonElement).disabled).toBe(false));
  await user.click(screen.getByRole('button', { name: 'Next unread' }));
  expect(parseRoute(location.search)).toEqual({ review: 'r-1', file: 'src/a.ts', side: 'new', thread: 't-7' });
  await waitFor(() => expect(net.calls.filter((c) => c.method === 'POST').map((c) => c.body)).toEqual([{ threadId: 't-7' }]));
});

// Invariant: the filter is its own named tablist, so it reads as nested inside the pane's Threads tab.
test('the filter tablist is named "Thread filter", in the review and in a comparison', () => {
  const { unmount } = render(<ReviewProvider value={ctxValue({ fileDiff: { file: undefined } as never })}><ThreadPanel /></ReviewProvider>);
  expect(screen.getByRole('tablist', { name: 'Thread filter' })).toBeTruthy();
  unmount();
  render(<ReviewProvider value={comparison()}><ThreadPanel /></ReviewProvider>);
  expect(screen.getByRole('tablist', { name: 'Thread filter' })).toBeTruthy();
});

test('the All count is the shown threads\' counts, not the review\'s', () => {
  const value = ctxValue({ review: review({ counts: { ...review().counts, threads: { open: 9, resolved: 9, outdated: 0 } } }), threadCounts: { open: 2, resolved: 1, outdated: 0 }, fileDiff: { file: undefined } as never });
  render(<ReviewProvider value={value}><ThreadPanel /></ReviewProvider>);
  expect(screen.getByRole('tab', { name: /^All/ }).textContent).toContain('3');
});

test('in a round view the All list reads each file\'s threads from that round', async () => {
  const net = stubFetch({ 'GET api/reviews/r-1/diff': { readOnly: true, round: { n: 1 }, files: [diffFile({ threads: [thread({ id: 't-1' })] })] } });
  const files = [fileState({ threads: { open: 1, resolved: 0, outdated: 0 } })];
  render(<ReviewProvider value={ctxValue({ files, round: 1, readOnly: true, fileDiff: { file: undefined } as never })}><ThreadPanel /></ReviewProvider>);
  await userEvent.setup().click(screen.getByRole('tab', { name: /^All/ }));
  expect(await screen.findAllByRole('article')).toHaveLength(1);
  expect(net.calls[0].url.searchParams.get('round')).toBe('1');
});

// Invariant: the thread panel's cards go through the markdown renderer.
test('thread panel cards render bodies as markdown', async () => {
  const t = thread({ id: 't-1', messages: [message({ body: 'a **bold** claim' })] });
  stubFetch({ 'GET api/reviews/r-1/diff': { review: review(), files: [diffFile({ threads: [t] })] } });
  const files = [fileState({ threads: { open: 1, resolved: 0, outdated: 0 } })];
  render(<ReviewProvider value={ctxValue({ files, fileDiff: { file: undefined } as never })}><ThreadPanel /></ReviewProvider>);
  await userEvent.setup().click(screen.getByRole('tab', { name: /^All/ }));
  const [article] = await screen.findAllByRole('article');
  expect(within(article).getByText('bold').tagName).toBe('STRONG');
});

/** A comparison of rounds 1 → 2: t-1 with both copies in src/a.ts, t-2 a round-2 copy there, t-3 on the base side. */
function comparison(over: Partial<ReturnType<typeof ctxValue>> = {}) {
  const copy = (id: string, placement: 'from' | 'to', side: 'old' | 'new' = placement === 'from' ? 'old' : 'new') =>
    ({ ...thread({ id, anchor: linesAnchor({ side }) }), placement, outdatedIn: null }) as ComparedThread;
  const file = { ...diffFile(), threads: [copy('t-1', 'from'), copy('t-1', 'to'), copy('t-2', 'to')] };
  const unplaced: UnplacedThread[] = [{ ...copy('t-3', 'to', 'old'), reason: 'base-side' }];
  const round = (n: number) => ({ n, headSha: `${n}`.repeat(40), baseSha: 'b'.repeat(40), createdAt: '', submittedAt: null });
  const view = { readOnly: true as const, from: round(1), to: round(2), files: [file], counts: { open: 1, resolved: 0, outdated: 2 }, unplaced, reviewThreads: [] };
  return ctxValue({ compare: { from: 1, to: 2, view }, readOnly: true, threadCounts: view.counts, fileDiff: { file } as never, ...over });
}

// Invariant: a comparison's panel lists the threads it could not place, each with its reason, and has no Outdated tab.
test('in a comparison, Not in diff lists the unplaced threads with their reason, and there is no Outdated tab', async () => {
  const net = stubFetch({});
  render(<ReviewProvider value={comparison()}><ThreadPanel /></ReviewProvider>);
  expect(screen.queryByRole('tab', { name: /^Outdated/ })).toBeNull();
  await userEvent.setup().click(screen.getByRole('tab', { name: /^Not in diff/ }));
  const [card] = screen.getAllByRole('article');
  expect(screen.getAllByRole('article')).toHaveLength(1);
  expect(card.textContent).toContain('on the base side');
  expect(net.calls).toEqual([]);
});

// Invariant: All shows (and counts) every compared thread once, placed or not, without fetching per-file diffs.
test('in a comparison, All lists each thread once and This file dedupes the open file\'s copies', async () => {
  const net = stubFetch({});
  render(<ReviewProvider value={comparison()}><ThreadPanel /></ReviewProvider>);
  expect(screen.getAllByRole('article')).toHaveLength(2);
  expect(screen.getByRole('tab', { name: /^All/ }).textContent).toContain('3');
  await userEvent.setup().click(screen.getByRole('tab', { name: /^All/ }));
  expect(screen.getAllByRole('article')).toHaveLength(3);
  expect(net.calls).toEqual([]);
});

// Invariant: a failed comparison shows its error with Retry in every tab, never a list or a "nothing here" claim.
test('in a failed comparison every tab shows the error with Retry, and Retry reloads the comparison', async () => {
  const reload = vi.fn();
  const viewLoad = { loading: false, error: { code: 'SNAPSHOT_GONE', reason: 'gone' }, reload };
  render(<ReviewProvider value={comparison({ compare: { from: 1, to: 2 }, viewLoad, fileDiff: { file: undefined } as never })}><ThreadPanel /></ReviewProvider>);
  const user = userEvent.setup();
  for (const tab of [/^This file/, /^All/, /^Not in diff/]) {
    await user.click(screen.getByRole('tab', { name: tab }));
    const panel = screen.getByRole('tabpanel');
    expect(within(panel).queryByRole('status', { name: 'Loading threads' }), String(tab)).toBeNull();
    expect(within(panel).queryByText(/Every thread has a place|No threads/), String(tab)).toBeNull();
    await user.click(within(panel).getByRole('button', { name: 'Retry' }));
  }
  expect(reload).toHaveBeenCalledTimes(3);
});

// Invariant: before the comparison has loaded, every tab says it is loading, never that it is empty.
test('while a comparison loads every tab shows Loading, not an empty claim', async () => {
  const viewLoad = { loading: true, error: undefined, reload: vi.fn() };
  render(<ReviewProvider value={comparison({ compare: { from: 1, to: 2 }, viewLoad, fileDiff: { file: undefined } as never })}><ThreadPanel /></ReviewProvider>);
  const user = userEvent.setup();
  for (const tab of [/^This file/, /^All/, /^Not in diff/]) {
    await user.click(screen.getByRole('tab', { name: tab }));
    const panel = screen.getByRole('tabpanel');
    expect(within(panel).getByRole('status', { name: 'Loading threads' }), String(tab)).toBeTruthy();
    expect(within(panel).queryByText(/Every thread has a place|No threads/), String(tab)).toBeNull();
  }
});

// Invariant: a failed reload keeps the comparison already loaded (useFetch retains its data), so its lists stay.
test('a loaded comparison whose reload failed still lists its threads in every tab', async () => {
  const viewLoad = { loading: false, error: { code: 'SYSTEM_UNREACHABLE', reason: 'down' }, reload: vi.fn() };
  render(<ReviewProvider value={comparison({ viewLoad })}><ThreadPanel /></ReviewProvider>);
  const user = userEvent.setup();
  for (const [tab, n] of [[/^This file/, 2], [/^All/, 3], [/^Not in diff/, 1]] as const) {
    await user.click(screen.getByRole('tab', { name: tab }));
    const panel = screen.getByRole('tabpanel');
    expect(within(panel).queryByRole('button', { name: 'Retry' }), String(tab)).toBeNull();
    expect(within(panel).getAllByRole('article'), String(tab)).toHaveLength(n);
  }
});

// Invariant: the Outdated tab lists each thread with its location link (it opens the thread's comparison).
test('the Outdated tab shows each thread\'s location link', async () => {
  const t = thread({ status: 'outdated' });
  const files = [fileState({ threads: { open: 0, resolved: 0, outdated: 1 } })];
  render(<ReviewProvider value={ctxValue({ files, outdatedThreads: [t], fileDiff: { file: undefined } as never })}><ThreadPanel /></ReviewProvider>);
  await userEvent.setup().click(screen.getByRole('tab', { name: /^Outdated/ }));
  expect(screen.getByRole('button', { name: 'src/a.ts · L3 (new)' })).toBeTruthy();
});

// Invariant: Focus on a thread the comparison does not place only focuses it: its anchor's side means the base there,
// not round A's head, so navigating to file and lines would highlight the wrong snapshot.
test('in a comparison, Focus on an unplaced thread adds only the thread to the route', async () => {
  history.replaceState(null, '', '?review=r-1&compare=1..2');
  render(<ReviewProvider value={comparison()}><ThreadPanel /></ReviewProvider>);
  const user = userEvent.setup();
  await user.click(screen.getByRole('tab', { name: /^Not in diff/ }));
  await user.click(screen.getByRole('button', { name: 'Focus' }));
  expect(parseRoute(location.search)).toEqual({ review: 'r-1', compare: '1..2', thread: 't-3' });
});

// Invariant: Focus on a placed thread inside a comparison stays in it: `compare` is never cleared.
test('in a comparison, Focus on a thread of another file keeps the comparison open', async () => {
  history.replaceState(null, '', '?review=r-1&compare=1..2&file=src%2Fb.ts');
  render(<ReviewProvider value={comparison()}><ThreadPanel /></ReviewProvider>);
  const user = userEvent.setup();
  await user.click(screen.getByRole('tab', { name: /^All/ }));
  const t2 = screen.getAllByRole('article')[1];
  await user.click(within(t2).getByRole('button', { name: 'Focus' }));
  expect(parseRoute(location.search)).toMatchObject({ compare: '1..2', file: 'src/a.ts', thread: 't-2' });
});

// Invariant: the owner filter keeps the threads the user (human) or agents opened, and composes with the status filter.
test('the All list filters by owner, composed with the status filter', async () => {
  const threads = [
    thread({ id: 't-1', openedBy: HUMAN }),
    thread({ id: 't-2', openedBy: agent('s-rev') }),
    thread({ id: 't-3', openedBy: agent('s-cond', 'conductor'), status: 'resolved' }),
  ];
  stubFetch({ 'GET api/reviews/r-1/diff': { review: review(), files: [diffFile({ threads })] } });
  const files = [fileState({ threads: { open: 2, resolved: 1, outdated: 0 } })];
  const user = userEvent.setup();
  render(<ReviewProvider value={ctxValue({ files, fileDiff: { file: undefined } as never })}><ThreadPanel /></ReviewProvider>);
  await user.click(screen.getByRole('tab', { name: /^All/ }));
  const owner = await screen.findByRole('combobox', { name: 'Owner' });
  const status = screen.getByRole('combobox', { name: 'Status' });
  const shown = () => screen.getAllByRole('article').length;
  await waitFor(() => expect(shown()).toBe(2));
  await user.selectOptions(owner, 'agents');
  await waitFor(() => expect(shown()).toBe(1));
  await user.selectOptions(status, 'all');
  await waitFor(() => expect(shown()).toBe(2));
  await user.selectOptions(owner, 'user');
  await waitFor(() => expect(shown()).toBe(1));
  await user.selectOptions(owner, 'all');
  await waitFor(() => expect(shown()).toBe(3));
});

// Invariant: a comparison's All list has the same owner filter.
test('a comparison\'s All list filters by owner', async () => {
  const user = userEvent.setup();
  render(<ReviewProvider value={comparison()}><ThreadPanel /></ReviewProvider>);
  await user.click(screen.getByRole('tab', { name: /^All/ }));
  const owner = screen.getByRole('combobox', { name: 'Owner' });
  await user.selectOptions(owner, 'user');
  expect(screen.getAllByRole('article')).toHaveLength(3);
  await user.selectOptions(owner, 'agents');
  expect(screen.queryAllByRole('article')).toHaveLength(0);
  expect(screen.getByText('No threads')).toBeTruthy();
});

// ---- review threads ----

const onReview = (over: Partial<Thread> = {}) => thread({ id: 't-r', anchor: { kind: 'review', round: 1 }, ...over });
const reviewTab = () => screen.getByRole('tab', { name: /^Review/ });

// Invariant: the Review tab lists the review's own threads, counted on the tab.
test('the Review tab lists the review threads', async () => {
  render(<ReviewProvider value={ctxValue({ reviewThreads: [onReview()], fileDiff: { file: undefined } as never })}><ThreadPanel /></ReviewProvider>);
  expect(reviewTab().textContent).toContain('1');
  await userEvent.setup().click(reviewTab());
  const [card] = screen.getAllByRole('article');
  expect(screen.getAllByRole('article')).toHaveLength(1);
  expect(within(card).getByText('Review')).toBeTruthy();
});

// Invariant: New review thread posts a review anchor; a read-only view does not offer it.
test('New review thread posts {kind: review}; read-only there is none', async () => {
  const net = stubFetch({ 'POST api/reviews/r-1/threads': { thread: onReview(), fileSig: null } });
  const user = userEvent.setup();
  const { unmount } = render(<ReviewProvider value={ctxValue({ fileDiff: { file: undefined } as never })}><ThreadPanel /></ReviewProvider>);
  await user.click(reviewTab());
  await user.click(screen.getByRole('button', { name: 'New review thread' }));
  await user.type(screen.getByLabelText('Message'), 'overall');
  await user.click(screen.getByRole('button', { name: 'Post' }));
  await waitFor(() => expect(net.calls.find((c) => c.method === 'POST')?.body).toEqual({ anchor: { kind: 'review' }, kind: 'comment', body: 'overall' }));
  unmount();
  render(<ReviewProvider value={ctxValue({ readOnly: true, fileDiff: { file: undefined } as never })}><ThreadPanel /></ReviewProvider>);
  await user.click(reviewTab());
  expect(screen.queryByRole('button', { name: 'New review thread' })).toBeNull();
});

// Invariant: All lists the review threads beside the file threads, so it matches the All count.
test('All includes the review threads', async () => {
  stubFetch({ 'GET api/reviews/r-1/diff': { review: review(), files: [diffFile({ threads: [thread({ id: 't-1' })] })] } });
  const files = [fileState({ threads: { open: 1, resolved: 0, outdated: 0 } })];
  render(<ReviewProvider value={ctxValue({ files, reviewThreads: [onReview()], fileDiff: { file: undefined } as never })}><ThreadPanel /></ReviewProvider>);
  await userEvent.setup().click(screen.getByRole('tab', { name: /^All/ }));
  await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(2));
  expect(screen.getByRole('button', { name: 'Review' })).toBeTruthy();
});

// Invariant: Next unread reaches an unread review thread and routes it to the Threads pane, keeping the open file.
test('"Next unread" reaches an unread review thread', async () => {
  history.replaceState(null, '', '?review=r-1&file=src%2Fa.ts');
  stubFetch({ 'POST api/reviews/r-1/read': { review: review() } });
  const user = userEvent.setup();
  render(<ReviewProvider value={ctxValue({ reviewThreads: [onReview({ unread: 1 })], fileDiff: { file: undefined } as never })}><ThreadPanel /></ReviewProvider>);
  await user.click(screen.getByRole('tab', { name: /^All/ }));
  await user.click(screen.getByRole('button', { name: 'Next unread' }));
  expect(parseRoute(location.search)).toEqual({ review: 'r-1', file: 'src/a.ts', thread: 't-r', view: 'threads' });
  await waitFor(() => expect(reviewTab().getAttribute('aria-selected')).toBe('true'));
});

// Invariant: a route naming a review thread selects the Review tab, where its card is.
test('a route naming a review thread selects the Review tab', () => {
  history.replaceState(null, '', '?review=r-1&view=threads&thread=t-r');
  stubFetch({ 'POST api/reviews/r-1/read': { review: review() } });
  render(<ReviewProvider value={ctxValue({ reviewThreads: [onReview()], fileDiff: { file: undefined } as never })}><ThreadPanel /></ReviewProvider>);
  expect(reviewTab().getAttribute('aria-selected')).toBe('true');
});

// Invariant: a comparison lists round B's review threads read-only in its Review tab and in All, with no compare note.
test('in a comparison the Review tab lists the review threads read-only, and All includes them', async () => {
  const user = userEvent.setup();
  render(<ReviewProvider value={comparison({ reviewThreads: [onReview()] })}><ThreadPanel /></ReviewProvider>);
  await user.click(reviewTab());
  expect(screen.getAllByRole('article')).toHaveLength(1);
  expect(screen.queryByRole('button', { name: 'New review thread' })).toBeNull();
  expect(screen.getByRole('tab', { name: /^All/ }).textContent).toContain('4');
  await user.click(screen.getByRole('tab', { name: /^All/ }));
  const card = screen.getAllByRole('article').find((a) => within(a).queryByRole('button', { name: 'Review' }))!;
  expect(card.textContent).not.toMatch(/round \d/);
});
