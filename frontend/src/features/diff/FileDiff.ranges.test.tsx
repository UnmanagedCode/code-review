import { act, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, test } from 'vitest';
import { navigate } from '@/lib/route';
import type { ComparedThread, DiffFile, Side, Thread, ThreadKind } from '@/lib/types';
import { WIDE_QUERY } from '@/lib/useMediaQuery';
import { installMedia } from '@/test/fakeMedia';
import { installResizeObserver } from '@/test/fakeResizeObserver';
import { diffFile, hunk, thread } from '@/test/fixtures';
import { renderDiff } from '@/test/renderCtx';
import { FileDiff } from './FileDiff';

// Default fixture hunk: c1 c2 d3 a3 c4 (old 1–4, new 1–4).
let ro: ReturnType<typeof installResizeObserver>;
beforeEach(() => {
  installMedia({ [WIDE_QUERY]: true });
  ro = installResizeObserver();
  history.replaceState(null, '', '?file=src%2Fa.ts');
});

const at = (id: string, side: Side, startLine: number, endLine: number, over: Partial<Thread> = {}) =>
  thread({ id, ...over, anchor: { ...thread().anchor, side, startLine, endLine } });
const show = (view: 'inline' | 'split', file: DiffFile, over = {}) => {
  localStorage.setItem('code-review:diffView', view);
  const r = renderDiff(<FileDiff />, file, over);
  ro.resize('all', 1000);
  return r;
};
const rowWith = (text: string) => screen.getAllByRole('row').find((r) => within(r).queryAllByText(text).length > 0)!;
/** The `[side, line]` of every gutter cell whose accessible name says it sits in `range` (enabled cells carry data-cell). */
const marked = (range: string) => screen.getAllByRole('gridcell')
  .filter((c) => c.getAttribute('data-cell') && (c.getAttribute('aria-label') ?? '').includes(`in ${range}`))
  .map((c) => c.getAttribute('data-cell'));
/**
 * Read-only gutters carry no data-cell: the `side:n` of each gutter cell, by column (inline: old, new; split: the first
 * cell of each half), whose text includes `range`.
 */
const markedReadOnly = (range: string, split: boolean) => screen.getAllByRole('row').flatMap((row) => {
  const cells = [...row.querySelectorAll<HTMLElement>('[role="gridcell"]')];
  const gutters: [Side, HTMLElement | undefined][] = split ? [['old', cells[0]], ['new', cells[3]]] : [['old', cells[0]], ['new', cells[1]]];
  return gutters.filter(([, c]) => c?.textContent?.includes(`in ${range}`)).map(([side, c]) => `${side}:${c!.textContent!.match(/^\d+/)![0]}`);
});

// Invariant: inline, a new-side range marks the new gutter of each of its lines, and no old gutter or line outside it.
test('inline: a new-side range is announced on its new gutters only', () => {
  show('inline', diffFile({ threads: [at('t-1', 'new', 2, 3)] }));
  expect(marked('comment thread L2–L3 (new)')).toEqual(['new:2', 'new:3']);
  expect(screen.getByRole('gridcell', { name: 'old line 2' })).toBeTruthy();
});

// Invariant: split, a new-side range marks right-half gutters only and an old-side range left-half gutters only.
test('split: each range is marked in its own half', () => {
  show('split', diffFile({ threads: [at('t-1', 'new', 2, 3), at('t-2', 'old', 3, 3, { kind: 'finding' })] }));
  expect(within(rowWith('d3')).queryByText('a3')).toBeTruthy();
  expect(marked('comment thread L2–L3 (new)')).toEqual(['new:2', 'new:3']);
  expect(marked('finding thread L3 (old)')).toEqual(['old:3']);
});

describe.each(['inline', 'split'] as const)('compare, %s', (view) => {
  const copy = (id: string, kind: ThreadKind, placement: 'from' | 'to', n: number): ComparedThread => ({
    ...at(id, placement === 'from' ? 'old' : 'new', n, n, { kind }), placement, outdatedIn: null,
  });
  // Invariant: a round-A copy marks old gutters (round A's head) only, a round-B copy new gutters (round B's head) only.
  test('a from-copy marks old gutters only and a to-copy new gutters only', () => {
    history.replaceState(null, '', '?file=src%2Fa.ts&compare=1..2');
    const threads = [copy('t-1', 'comment', 'from', 3), copy('t-1', 'comment', 'to', 3), copy('t-2', 'question', 'from', 1), copy('t-2', 'question', 'to', 4)];
    show(view, diffFile({ hunks: [hunk({ verdict: null })], threads }), { compare: { from: 1, to: 2 }, readOnly: true });
    const split = view === 'split';
    expect(markedReadOnly('comment thread L3 (old)', split)).toEqual(['old:3']);
    expect(markedReadOnly('comment thread L3 (new)', split)).toEqual(['new:3']);
    expect(markedReadOnly('question thread L1 (old)', split)).toEqual(['old:1']);
    expect(markedReadOnly('question thread L4 (new)', split)).toEqual(['new:4']);
  });
});

const mountAccepted = (threads: Thread[]) => {
  localStorage.setItem('code-review:diffView', 'inline');
  renderDiff(<FileDiff />, diffFile({ hunks: [hunk({ verdict: 'accepted' })], threads }));
  ro.resize('all', 1000);
};
const go = (thread: string | undefined) => act(() => navigate({ thread }));
const active = (n: number) => screen.getByRole('gridcell', { name: new RegExp(`^new line ${n} ·`) }).querySelector('[data-rails]')!.hasAttribute('data-active');

// Invariant: only the focused thread's rails are marked active, and focus moving moves the active state.
test('the focused thread\'s rails are active and no other thread\'s are', () => {
  history.replaceState(null, '', '?file=src%2Fa.ts&thread=t-1');
  mountAccepted([at('t-1', 'new', 2, 3), at('t-2', 'new', 4, 4)]);
  expect([2, 3, 4].map(active)).toEqual([true, true, false]);
  go('t-2');
  expect([2, 3, 4].map(active)).toEqual([false, false, true]);
});

// Invariant: an accepted hunk holding the focused thread's range is open while it is focused and collapses again when
// it is not; marking alone forces nothing open.
test('focusing a thread keeps the accepted hunk holding its range open', () => {
  mountAccepted([at('t-1', 'new', 2, 3)]);
  expect(screen.queryByRole('gridcell', { name: /^new line 2/ })).toBeNull();
  go('t-1');
  expect(screen.getByRole('gridcell', { name: /^new line 2 ·/ })).toBeTruthy();
  go(undefined);
  expect(screen.queryByRole('gridcell', { name: /^new line 2/ })).toBeNull();
});

/** Every line row's classes and its cells' classes, in order: what a row looks like, without naming any style. */
const rowLooks = () => screen.getAllByRole('row').map((r) => [r.className, ...[...r.querySelectorAll('[role="gridcell"]')].map((c) => c.className)]);

// Invariant: a thread adds nothing to a row or its cells (no tint over the add/del colours, in either view): the same
// file renders identically with and without threads over its added, deleted and context lines, and the range is
// exposed only through the gutter's rails and accessible name.
test.each(['inline', 'split'] as const)('%s: a thread adds nothing to the rows it spans', (view) => {
  const { unmount } = show(view, diffFile());
  const bare = rowLooks();
  unmount();
  show(view, diffFile({ threads: [at('t-1', 'old', 2, 3), at('t-2', 'new', 2, 4)] }));
  expect(rowLooks()).toEqual(bare);
  expect(document.querySelector('[data-line-target]')).toBeNull();
  expect(marked('comment thread L2–L3 (old)')).toEqual(['old:2', 'old:3']);
  expect(marked('comment thread L2–L4 (new)')).toEqual(['new:2', 'new:3', 'new:4']);
});

// Invariant: FileDiff asks the file diff to reveal each thread's whole range, not only its last line.
test('every thread\'s whole range is requested for reveal', () => {
  const { value } = show('inline', diffFile({ threads: [at('t-1', 'new', 2, 3), at('t-2', 'old', 1, 1)] }));
  expect(value.fileDiff.reveal).toHaveBeenCalledWith([{ side: 'new', start: 2, end: 3 }, { side: 'old', start: 1, end: 1 }]);
});
