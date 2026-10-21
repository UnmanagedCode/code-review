import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { diffFile, fileState, message, review, thread } from '@/test/fixtures';
import { ctxValue } from '@/test/renderCtx';
import { stubFetch } from '@/test/stubFetch';
import type { ComparedThread, UnplacedThread } from '@/lib/types';
import { ReviewProvider } from '@/state/reviewContext';
import { ThreadPanel } from './ThreadPanel';

test('the All list refreshes when the review reloads, even with no file open', async () => {
  let threads = [thread({ id: 't-1' })];
  const net = stubFetch({ 'GET api/reviews/r-1/diff': () => ({ review: review(), files: [diffFile({ threads })] }) });
  const files = [fileState({ threads: { open: 1, resolved: 0, outdated: 0 } })];
  const base = ctxValue({ files, fileDiff: { file: undefined, version: 0 } as never });
  const ui = (version: number) => <ReviewProvider value={{ ...base, version }}><ThreadPanel /></ReviewProvider>;
  const { rerender } = render(ui(1));
  await userEvent.setup().click(screen.getByRole('tab', { name: /^All/ }));
  expect(await screen.findAllByRole('article')).toHaveLength(1);
  threads = [thread({ id: 't-1' }), thread({ id: 't-2' })];
  rerender(ui(2));
  await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(2));
  expect(net.count('GET api/reviews/r-1/diff')).toBe(2);
});

test('"Next unread" focuses the first unread thread, which posts read {threadId}', async () => {
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
  expect(location.search).toContain('thread=t-7');
  await waitFor(() => expect(net.calls.filter((c) => c.method === 'POST').map((c) => c.body)).toEqual([{ threadId: 't-7' }]));
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
    ({ ...thread({ id, anchor: { ...thread().anchor, side } }), placement, outdatedIn: null }) as ComparedThread;
  const file = { ...diffFile(), threads: [copy('t-1', 'from'), copy('t-1', 'to'), copy('t-2', 'to')] };
  const unplaced: UnplacedThread[] = [{ ...copy('t-3', 'to', 'old'), reason: 'base-side' }];
  const round = (n: number) => ({ n, headSha: `${n}`.repeat(40), baseSha: 'b'.repeat(40), createdAt: '', submittedAt: null });
  const view = { readOnly: true as const, from: round(1), to: round(2), files: [file], counts: { open: 1, resolved: 0, outdated: 2 }, unplaced };
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
