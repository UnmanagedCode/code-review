import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { agent, diffFile, fileState, groupAnchor, guideGroup, guideView, HUMAN, message, review, thread, threadDigest, linesAnchor } from '@/test/fixtures';
import { parseRoute } from '@/lib/route';
import { ctxValue } from '@/test/renderCtx';
import { stubFetch } from '@/test/stubFetch';
import type { ComparedThread, Thread, UnplacedThread } from '@/lib/types';
import { ReviewProvider } from '@/test/reviewProvider';
import { ThreadPanel } from './ThreadPanel';

/** A thread's compact rows: buttons named "<state or status>: <place> — <preview>". */
const rows = () => screen.queryAllByRole('button', { name: /: .+ — / });
const digestOf = (t: Thread, state: Thread['state'] = 'awaiting-human') => threadDigest({ id: t.id, state, anchor: t.anchor, openedBy: t.openedBy, unread: t.unread });

// Invariant: a resolved list (the one the digests do not hold) is read from the files' diffs and refreshes when a file's sig moves, even with no file open.
test('the Resolved list refreshes when the review reloads, even with no file open', async () => {
  let threads = [thread({ id: 't-1', status: 'resolved' })];
  const net = stubFetch({ 'GET api/reviews/r-1/diff': () => ({ review: review(), files: [diffFile({ threads, sig: threads.length === 1 ? 's1' : 's2' })] }) });
  const ui = (files: ReturnType<typeof fileState>[]) => <ReviewProvider value={ctxValue({ files, fileDiff: { file: undefined } as never })}><ThreadPanel /></ReviewProvider>;
  const { rerender } = render(ui([fileState({ sig: 's1', threads: { open: 0, resolved: 1, outdated: 0 } })]));
  await userEvent.setup().selectOptions(screen.getByLabelText('Status'), 'resolved');
  await waitFor(() => expect(rows()).toHaveLength(1));
  threads = [thread({ id: 't-1', status: 'resolved' }), thread({ id: 't-2', status: 'resolved' })];
  rerender(ui([fileState({ sig: 's2', threads: { open: 0, resolved: 2, outdated: 0 } })]));
  await waitFor(() => expect(rows()).toHaveLength(2));
  expect(net.count('GET api/reviews/r-1/diff')).toBe(2);
});

// Invariant: Next unread focuses the thread by route (file, side, thread) and sets no `lines=` row wash; its card then posts the read mark.
test('"Next unread" focuses the first unread thread, which posts read {threadId}', async () => {
  history.replaceState(null, '', '?review=r-1&lines=9');
  const first = thread({ id: 't-1' });
  const unread = thread({ id: 't-7', unread: 1 });
  const net = stubFetch({ 'POST api/reviews/r-1/read': { review: review() } });
  const files = [fileState({ threads: { open: 2, resolved: 0, outdated: 0 } })];
  const value = ctxValue({ files, openThreads: [digestOf(first), digestOf(unread)], fileDiff: { file: diffFile({ threads: [first, unread] }) } as never });
  const user = userEvent.setup();
  render(<ReviewProvider value={value}><ThreadPanel /></ReviewProvider>);
  expect((screen.getByRole('button', { name: 'Next unread' }) as HTMLButtonElement).disabled).toBe(false);
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

// Invariant: under the default filters (Open, all owners, no need) the All tab counts exactly the open threads it lists: the overview's digests, whatever the files' counts say.
test('the All count is the number of open threads listed', () => {
  const value = ctxValue({ openThreads: [digestOf(thread({ id: 't-1' })), digestOf(thread({ id: 't-2' }), 'unsent')], fileDiff: { file: undefined } as never });
  render(<ReviewProvider value={value}><ThreadPanel /></ReviewProvider>);
  expect(screen.getByRole('tab', { name: /^All/ }).textContent).toBe('All 2');
  expect(rows()).toHaveLength(2);
});

// Invariant: a past round's threads are not in the digests: the All list reads each file's diff of that round.
test('in a round view the All list reads each file\'s threads from that round', async () => {
  const net = stubFetch({ 'GET api/reviews/r-1/diff': { readOnly: true, round: { n: 1 }, files: [diffFile({ threads: [thread({ id: 't-1' })] })] } });
  const files = [fileState({ threads: { open: 1, resolved: 0, outdated: 0 } })];
  render(<ReviewProvider value={ctxValue({ files, round: 1, readOnly: true, fileDiff: { file: undefined } as never })}><ThreadPanel /></ReviewProvider>);
  await waitFor(() => expect(rows()).toHaveLength(1));
  expect(net.calls[0].url.searchParams.get('round')).toBe('1');
});

// Invariant: the routed thread opens as its full card, whose bodies go through the markdown renderer.
test('the routed thread\'s card renders bodies as markdown', async () => {
  history.replaceState(null, '', '?review=r-1&view=threads&thread=t-1');
  const t = thread({ id: 't-1', messages: [message({ body: 'a **bold** claim' })] });
  stubFetch({});
  render(<ReviewProvider value={ctxValue({ openThreads: [digestOf(t)], fileDiff: { file: diffFile({ threads: [t] }) } as never })}><ThreadPanel /></ReviewProvider>);
  const article = await screen.findByRole('article');
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
  const viewLoad = { loading: false, error: { code: 'SNAPSHOT_GONE', reason: 'gone' }, loaded: false, reload };
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
  const viewLoad = { loading: true, error: undefined, loaded: false, reload: vi.fn() };
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
  const viewLoad = { loading: false, error: { code: 'SYSTEM_UNREACHABLE', reason: 'down' }, loaded: true, reload: vi.fn() };
  render(<ReviewProvider value={comparison({ viewLoad })}><ThreadPanel /></ReviewProvider>);
  const user = userEvent.setup();
  for (const [tab, n] of [[/^This file/, 2], [/^All/, 3], [/^Not in diff/, 1]] as const) {
    await user.click(screen.getByRole('tab', { name: tab }));
    const panel = screen.getByRole('tabpanel');
    expect(within(panel).queryByRole('button', { name: 'Retry' }), String(tab)).toBeNull();
    expect(within(panel).getAllByRole('article'), String(tab)).toHaveLength(n);
  }
});

// Invariant: the Outdated tab lists each thread as a row naming its place; the row opens the thread's comparison.
test('the Outdated tab shows each thread\'s place as a row that opens its comparison', async () => {
  const t = thread({ status: 'outdated' });
  const files = [fileState({ threads: { open: 0, resolved: 0, outdated: 1 } })];
  render(<ReviewProvider value={ctxValue({ files, outdatedThreads: [t], fileDiff: { file: undefined } as never })}><ThreadPanel /></ReviewProvider>);
  const user = userEvent.setup();
  await user.click(screen.getByRole('tab', { name: /^Outdated/ }));
  await user.click(screen.getByRole('button', { name: /^outdated: a\.ts#L3 — / }));
  expect(parseRoute(location.search)).toMatchObject({ compare: '1..2', file: 'src/a.ts', thread: 't-1' });
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

// Invariant: the owner filter keeps the threads the user (human) or agents opened, and composes with the status filter (open from the digests, resolved from the files' diffs).
test('the All list filters by owner, composed with the status filter', async () => {
  const [t1, t2] = [thread({ id: 't-1', openedBy: HUMAN }), thread({ id: 't-2', openedBy: agent('s-rev') })];
  const t3 = thread({ id: 't-3', openedBy: agent('s-cond', 'conductor'), status: 'resolved' });
  stubFetch({ 'GET api/reviews/r-1/diff': { review: review(), files: [diffFile({ threads: [t3] })] } });
  const files = [fileState({ threads: { open: 2, resolved: 1, outdated: 0 } })];
  const user = userEvent.setup();
  render(<ReviewProvider value={ctxValue({ files, openThreads: [digestOf(t1), digestOf(t2)], fileDiff: { file: undefined } as never })}><ThreadPanel /></ReviewProvider>);
  const owner = screen.getByRole('combobox', { name: 'Owner' });
  const status = screen.getByRole('combobox', { name: 'Status' });
  await waitFor(() => expect(rows()).toHaveLength(2));
  await user.selectOptions(owner, 'agents');
  await waitFor(() => expect(rows()).toHaveLength(1));
  await user.selectOptions(status, 'all');
  await waitFor(() => expect(rows()).toHaveLength(2));
  await user.selectOptions(owner, 'user');
  await waitFor(() => expect(rows()).toHaveLength(1));
  await user.selectOptions(owner, 'all');
  await waitFor(() => expect(rows()).toHaveLength(3));
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
  expect(rows()).toHaveLength(1);
  expect(screen.getByRole('button', { name: /: review — / })).toBeTruthy();
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

// Invariant: All lists the review threads beside the file threads (the digests hold every anchor), so it matches the All count.
test('All includes the review threads', () => {
  const t1 = thread({ id: 't-1' });
  const files = [fileState({ threads: { open: 1, resolved: 0, outdated: 0 } })];
  render(<ReviewProvider value={ctxValue({ files, openThreads: [digestOf(t1), digestOf(onReview())], reviewThreads: [onReview()], fileDiff: { file: undefined } as never })}><ThreadPanel /></ReviewProvider>);
  expect(rows()).toHaveLength(2);
  expect(screen.getByRole('tab', { name: /^All/ }).textContent).toBe('All 2');
  expect(screen.getByRole('button', { name: /: review — / })).toBeTruthy();
});

// Invariant: Next unread reaches an unread review thread and routes it to the Threads pane, keeping the open file.
test('"Next unread" reaches an unread review thread', async () => {
  history.replaceState(null, '', '?review=r-1&file=src%2Fa.ts');
  stubFetch({ 'POST api/reviews/r-1/read': { review: review() } });
  const user = userEvent.setup();
  const t = onReview({ unread: 1 });
  render(<ReviewProvider value={ctxValue({ openThreads: [digestOf(t)], reviewThreads: [t], fileDiff: { file: undefined } as never })}><ThreadPanel /></ReviewProvider>);
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

// Invariant: in a past round the Review tab claims nothing until the round has loaded: a load shows Loading, a failed first
// load its error with Retry; a loaded round wins over a later error (a failed reload keeps the data).
test('in a past round the Review tab waits for the round, shows its error with Retry, and keeps loaded threads', async () => {
  const user = userEvent.setup();
  const reload = vi.fn();
  const past = (viewLoad: { loading: boolean; error: unknown; loaded: boolean }, reviewThreads: Thread[] = []) =>
    <ReviewProvider value={ctxValue({ round: 1, readOnly: true, viewLoad: { ...viewLoad, reload }, reviewThreads, fileDiff: { file: undefined } as never })}><ThreadPanel /></ReviewProvider>;
  const { rerender } = render(past({ loading: true, error: undefined, loaded: false }));
  await user.click(reviewTab());
  const panel = () => screen.getByRole('tabpanel', { name: /^Review/ });
  expect(within(panel()).getByRole('status', { name: 'Loading threads' })).toBeTruthy();
  expect(within(panel()).queryByText('No threads on the review')).toBeNull();
  rerender(past({ loading: false, error: { code: 'SNAPSHOT_GONE', reason: 'gone' }, loaded: false }));
  expect(within(panel()).queryByText('No threads on the review')).toBeNull();
  await user.click(within(panel()).getByRole('button', { name: 'Retry' }));
  expect(reload).toHaveBeenCalled();
  rerender(past({ loading: false, error: { code: 'SNAPSHOT_GONE', reason: 'gone' }, loaded: true }, [onReview()]));
  expect(within(panel()).getAllByRole('button', { name: /: review — / })).toHaveLength(1);
});

// Invariant: a filter tab that takes focus is scrolled into view within the sideways-scrolling strip, without scrolling the page.
test('a focused filter tab is scrolled into view', async () => {
  const scrolled = vi.fn();
  const spy = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(function (this: HTMLElement, arg) { scrolled(this, arg); });
  render(<ReviewProvider value={ctxValue({ fileDiff: { file: undefined } as never })}><ThreadPanel /></ReviewProvider>);
  screen.getByRole('tab', { name: /^This file/ }).focus();
  await userEvent.setup().keyboard('{ArrowRight}');
  const all = screen.getByRole('tab', { name: /^All/ });
  expect(document.activeElement).toBe(all);
  expect(scrolled).toHaveBeenCalledWith(all, { inline: 'nearest', block: 'nearest' });
  spy.mockRestore();
});

// Invariant: until a past round has loaded, no filter tab lists threads or claims there are none: each shows Loading,
// then the load error with Retry (as the comparison panel does).
test.each(['This file', 'All', 'Outdated', 'Review'])('in a past round still loading, %s shows Loading, then the error with Retry', async (name) => {
  const user = userEvent.setup();
  const reload = vi.fn();
  const past = (viewLoad: { loading: boolean; error: unknown }) =>
    <ReviewProvider value={ctxValue({ round: 1, readOnly: true, files: [], viewLoad: { ...viewLoad, loaded: false, reload }, fileDiff: { file: undefined } as never })}><ThreadPanel /></ReviewProvider>;
  const { rerender } = render(past({ loading: true, error: undefined }));
  await user.click(screen.getByRole('tab', { name: new RegExp(`^${name}`) }));
  const panel = () => screen.getByRole('tabpanel', { name: new RegExp(`^${name}`) });
  expect(within(panel()).getByRole('status', { name: 'Loading threads' })).toBeTruthy();
  expect(within(panel()).queryByText(/^No /)).toBeNull();
  rerender(past({ loading: false, error: { code: 'SNAPSHOT_GONE', reason: 'gone' } }));
  expect(within(panel()).queryByText(/^No /)).toBeNull();
  await user.click(within(panel()).getByRole('button', { name: 'Retry' }));
  expect(reload).toHaveBeenCalled();
});

const gThread = (id: string, status: Thread['status'] = 'open', groupId = 'g1') => thread({ id, status, anchor: groupAnchor({ groupId }) });
const groupPanel = (over: Partial<ReturnType<typeof ctxValue>> = {}) => {
  const guide = guideView({ groups: [guideGroup({ id: 'g1', title: 'Wire it up' })], threads: [gThread('t-4'), gThread('t-5', 'resolved'), gThread('t-6', 'outdated')] });
  return render(<ReviewProvider value={ctxValue({ guide, threadCounts: { open: 1, resolved: 1, outdated: 1 }, fileDiff: { file: undefined } as never, ...over })}><ThreadPanel /></ReviewProvider>);
};

// Invariant: All lists the live group threads (open ones from the digests, resolved ones from the guide), so its list is as long as the count on its tab; outdated ones wait in Outdated.
test('All lists live group threads (as many as its tab counts); Outdated lists the outdated ones', async () => {
  stubFetch({});
  groupPanel({ openThreads: [digestOf(gThread('t-4'))] });
  const user = userEvent.setup();
  expect(screen.getByRole('tab', { name: /^All/ }).textContent).toBe('All 1');
  await user.selectOptions(screen.getByLabelText('Status'), 'all');
  await waitFor(() => expect(rows()).toHaveLength(2));
  expect(screen.getByRole('tab', { name: /^All/ }).textContent).toBe('All 2');
  expect(screen.getByRole('tab', { name: /^Outdated/ }).textContent).toContain('1');
  await user.click(screen.getByRole('tab', { name: /^Outdated/ }));
  expect(rows()).toHaveLength(1);
});

// Invariant: group threads exist only in the live round, so a past round lists none.
test('a past round lists no group threads', async () => {
  stubFetch({});
  groupPanel({ round: 1, readOnly: true, pastView: true });
  await userEvent.setup().click(screen.getByRole('tab', { name: /^All/ }));
  expect(rows()).toHaveLength(0);
});

// Invariant: a group thread's row opens its Guided step, and Next unread reaches group threads.
test('a group thread\'s row routes to its Guided step, and Next unread reaches group threads', async () => {
  stubFetch({ 'POST api/reviews/r-1/read': { review: review() } });
  history.replaceState(null, '', '?review=r-1&view=threads&file=src%2Fa.ts');
  const t = { ...gThread('t-4'), unread: 1 };
  const guide = guideView({ groups: [guideGroup({ id: 'g1', title: 'Wire it up' })], threads: [t] });
  render(<ReviewProvider value={ctxValue({ guide, openThreads: [digestOf(t)], threadCounts: { open: 1, resolved: 0, outdated: 0 }, fileDiff: { file: undefined } as never })}><ThreadPanel /></ReviewProvider>);
  const user = userEvent.setup();
  expect((screen.getByRole('button', { name: 'Next unread' }) as HTMLButtonElement).disabled).toBe(false);
  await user.click(screen.getByRole('button', { name: /: Wire it up — / }));
  expect(parseRoute(location.search)).toEqual({ review: 'r-1', view: 'guided', step: 'g1', thread: 't-4' });
});

const stateful = (id: string, state: Thread['state']) => thread({ id, state });

// Invariant: need=needs-you opens All with open threads of any owner, lists exactly the NEEDS_YOU threads under one section, and its chip count equals the list.
test('need=needs-you lists exactly the awaiting-human and verify-resolution threads, with a chip counting them', () => {
  history.replaceState(null, '', '?review=r-1&view=threads&need=needs-you');
  const open = [stateful('t-1', 'awaiting-human'), stateful('t-2', 'verify-resolution'), stateful('t-3', 'unsent'), stateful('t-4', 'awaiting-agent')];
  render(<ReviewProvider value={ctxValue({ openThreads: open.map((t) => digestOf(t, t.state)), fileDiff: { file: undefined } as never })}><ThreadPanel /></ReviewProvider>);
  expect(rows()).toHaveLength(2);
  expect(screen.getByRole('tab', { name: /^All/ }).getAttribute('aria-selected')).toBe('true');
  expect(screen.getByText('Showing: Needs you · 2')).toBeTruthy();
  expect(screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'))).toEqual(['Needs you']);
});

// Invariant: the filter chip's ✕ drops `need` with replace, so the list shows every open thread again and Back is untouched.
test('the chip\'s ✕ clears need with a replace', async () => {
  history.replaceState(null, '', '?review=r-1&view=threads&need=unsent');
  const open = [stateful('t-1', 'unsent'), stateful('t-2', 'awaiting-agent')];
  const push = vi.spyOn(history, 'pushState');
  render(<ReviewProvider value={ctxValue({ openThreads: open.map((t) => digestOf(t, t.state)), fileDiff: { file: undefined } as never })}><ThreadPanel /></ReviewProvider>);
  expect(rows()).toHaveLength(1);
  await userEvent.setup().click(screen.getByRole('button', { name: 'Show all threads' }));
  expect(parseRoute(location.search)).toEqual({ review: 'r-1', view: 'threads' });
  await waitFor(() => expect(rows()).toHaveLength(2));
  expect(screen.queryByText(/^Showing:/)).toBeNull();
  expect(push).not.toHaveBeenCalled();
});

// Invariant: any other filter choice (tab, status, owner) drops need, so the list never disagrees with the URL.
test('changing the tab, status or owner clears need', async () => {
  stubFetch({ 'GET api/reviews/r-1/diff': { review: review(), files: [diffFile({ threads: [stateful('t-1', 'unsent')] })] } });
  const files = [fileState({ threads: { open: 1, resolved: 0, outdated: 0 } })];
  const user = userEvent.setup();
  for (const change of [
    () => user.click(screen.getByRole('tab', { name: /^Review/ })),
    () => user.selectOptions(screen.getByLabelText('Status'), 'all'),
    () => user.selectOptions(screen.getByLabelText('Owner'), 'agents'),
  ]) {
    history.replaceState(null, '', '?review=r-1&view=threads&need=unsent');
    const { unmount } = render(<ReviewProvider value={ctxValue({ files, fileDiff: { file: undefined } as never })}><ThreadPanel /></ReviewProvider>);
    await screen.findByText(/^Showing:/);
    await change();
    expect(parseRoute(location.search).need).toBeUndefined();
    unmount();
  }
});

// Invariant: the Threads panel opens on All (not This file), listing open threads in collapsible state sections.
test('the panel opens on All, with open threads under collapsible state sections', async () => {
  const open = [stateful('t-1', 'awaiting-human'), stateful('t-2', 'unsent'), stateful('t-3', 'awaiting-agent')];
  render(<ReviewProvider value={ctxValue({ openThreads: open.map((t) => digestOf(t, t.state)), fileDiff: { file: undefined } as never })}><ThreadPanel /></ReviewProvider>);
  expect(screen.getByRole('tab', { name: /^All/ }).getAttribute('aria-selected')).toBe('true');
  expect(screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'))).toEqual(['Needs you', 'Will be sent', 'Waiting on agent']);
  const header = screen.getByRole('button', { name: 'Will be sent 1' });
  expect(header.getAttribute('aria-expanded')).toBe('true');
  await userEvent.setup().click(header);
  expect(header.getAttribute('aria-expanded')).toBe('false');
  expect(rows()).toHaveLength(2);
});

// Invariant: only the routed thread opens as a full card with Reply; the others stay compact rows. Until its whole thread is loaded the row shows a loading line.
test('the routed thread expands to a card with Reply; others stay rows; a not-yet-loaded one shows loading', () => {
  history.replaceState(null, '', '?review=r-1&view=threads&thread=t-1');
  const [t1, t2] = [thread({ id: 't-1' }), thread({ id: 't-2' })];
  const open = [digestOf(t1), digestOf(t2)];
  const { unmount } = render(<ReviewProvider value={ctxValue({ openThreads: open, fileDiff: { file: diffFile({ threads: [t1, t2] }) } as never })}><ThreadPanel /></ReviewProvider>);
  expect(screen.getAllByRole('article')).toHaveLength(1);
  expect(screen.getByLabelText('Reply')).toBeTruthy();
  expect(rows()).toHaveLength(1);
  unmount();
  // The routed file's diff is still on its way: a loading line. With no file routed there is nothing to wait for: a plain row.
  history.replaceState(null, '', '?review=r-1&view=threads&thread=t-1&file=src%2Fa.ts');
  const { unmount: unmountLoading } = render(<ReviewProvider value={ctxValue({ openThreads: open, fileDiff: { file: undefined } as never })}><ThreadPanel /></ReviewProvider>);
  expect(screen.queryByRole('article')).toBeNull();
  expect(screen.getByRole('status', { name: 'Loading thread' })).toBeTruthy();
  unmountLoading();
  history.replaceState(null, '', '?review=r-1&view=threads&thread=t-1');
  render(<ReviewProvider value={ctxValue({ openThreads: open, fileDiff: { file: undefined } as never })}><ThreadPanel /></ReviewProvider>);
  expect(screen.queryByRole('status', { name: 'Loading thread' })).toBeNull();
  expect(rows()).toHaveLength(2);
});

// Invariant: the review's strip pill count, the chip and the list agree: with need=waiting only that section shows.
test('need=waiting shows only the waiting section', () => {
  history.replaceState(null, '', '?review=r-1&view=threads&need=waiting');
  const open = [stateful('t-1', 'awaiting-human'), stateful('t-2', 'awaiting-agent'), stateful('t-3', 'awaiting-agent')];
  render(<ReviewProvider value={ctxValue({ openThreads: open.map((t) => digestOf(t, t.state)), fileDiff: { file: undefined } as never })}><ThreadPanel /></ReviewProvider>);
  expect(screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'))).toEqual(['Waiting on agent']);
  expect(screen.getByText('Showing: Waiting on agent · 2')).toBeTruthy();
});

// Invariant: no per-file diff is fetched for the open list, nor while the panel is inactive (its tab is hidden), even for a resolved list.
test('an inactive panel and an Open list fetch no per-file diff', async () => {
  const net = stubFetch({ 'GET api/reviews/r-1/diff': { review: review(), files: [diffFile({ threads: [] })] } });
  const files = [fileState({ threads: { open: 1, resolved: 1, outdated: 0 } })];
  const value = ctxValue({ files, openThreads: [digestOf(thread())], fileDiff: { file: undefined } as never });
  const user = userEvent.setup();
  const { rerender } = render(<ReviewProvider value={value}><ThreadPanel active={false} /></ReviewProvider>);
  await user.selectOptions(screen.getByLabelText('Status'), 'resolved');
  await act(async () => {});
  expect(net.count('GET api/reviews/r-1/diff')).toBe(0);
  rerender(<ReviewProvider value={value}><ThreadPanel active /></ReviewProvider>);
  await waitFor(() => expect(net.count('GET api/reviews/r-1/diff')).toBe(1));
});

// Invariant: in a past round (threads carry no state) a `need=` is dropped from the route and no "Showing:" chip claims a filter the list does not apply.
test('need is cleared in a past round and no chip shows', async () => {
  history.replaceState(null, '', '?review=r-1&view=threads&need=needs-you&round=1');
  stubFetch({ 'GET api/reviews/r-1/diff': { readOnly: true, round: { n: 1 }, files: [diffFile({ threads: [thread({ id: 't-1' })] })] } });
  const files = [fileState({ threads: { open: 1, resolved: 0, outdated: 0 } })];
  render(<ReviewProvider value={ctxValue({ files, round: 1, readOnly: true, pastView: true, fileDiff: { file: undefined } as never })}><ThreadPanel /></ReviewProvider>);
  await waitFor(() => expect(rows()).toHaveLength(1));
  expect(screen.queryByText(/^Showing:/)).toBeNull();
  await waitFor(() => expect(parseRoute(location.search).need).toBeUndefined());
});
