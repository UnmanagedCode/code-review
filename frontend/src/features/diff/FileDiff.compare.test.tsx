import { screen, within } from '@testing-library/react';
import { beforeEach, expect, test } from 'vitest';
import type { ComparedThread, ThreadKind } from '@/lib/types';
import { WIDE_QUERY } from '@/lib/useMediaQuery';
import { installMedia } from '@/test/fakeMedia';
import { installResizeObserver } from '@/test/fakeResizeObserver';
import { diffFile, hunk, thread, linesAnchor } from '@/test/fixtures';
import { renderDiff } from '@/test/renderCtx';
import { FileDiff } from './FileDiff';

// A comparison of rounds 1 → 2. Compare hunk: c1 c2 d3 a3 c4 (old = round 1's head 1–4, new = round 2's head 1–4).
let ro: ReturnType<typeof installResizeObserver>;
beforeEach(() => {
  installMedia({ [WIDE_QUERY]: true });
  ro = installResizeObserver();
  history.replaceState(null, '', '?file=src%2Fa.ts&compare=1..2');
});

const copy = (id: string, kind: ThreadKind, placement: 'from' | 'to', n: number, outdatedIn: number | null = null): ComparedThread => ({
  ...thread({ id, kind, anchor: linesAnchor({ side: placement === 'from' ? 'old' : 'new', startLine: n, endLine: n, round: placement === 'from' ? 1 : 2 }) }),
  placement, outdatedIn,
});
// t-1: round-1 L3 (the deleted line) and round-2 L3 (the added line). t-2: round-1 L1, round-2 L4.
// t-3: round-1 L2 only, outdated in round 2.
const threads = [copy('t-1', 'comment', 'from', 3), copy('t-1', 'comment', 'to', 3), copy('t-2', 'question', 'from', 1), copy('t-2', 'question', 'to', 4), copy('t-3', 'suggestion', 'from', 2, 2)];

const show = (view: 'inline' | 'split') => {
  localStorage.setItem('code-review:diffView', view);
  renderDiff(<FileDiff />, diffFile({ hunks: [hunk({ verdict: null })], threads }), { compare: { from: 1, to: 2 }, readOnly: true });
  ro.resize('all', 1000);
};
const rowWith = (text: string) => screen.getAllByRole('row').find((r) => within(r).queryAllByText(text).length > 0)!;
/** The thread cards rendered after `row` and before the next row. */
const cardsUnder = (row: Element) => {
  const rows = screen.getAllByRole('row');
  const next = rows[rows.indexOf(row as HTMLElement) + 1];
  return screen.getAllByRole('article').filter((a) => (row.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING)
    && (!next || next.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_PRECEDING));
};
const kinds = (cards: HTMLElement[]) => cards.map((c) => c.getAttribute('aria-label'));

// Invariant: split puts a round-A copy under the pair whose left number is its line, a round-B copy under the pair
// whose right number is its line, and one card when both copies fall under one pair.
test('split: from-copies follow the left line, to-copies the right line, and two copies on one pair are one card', () => {
  show('split');
  expect(within(rowWith('d3')).queryByText('a3')).toBeTruthy();
  const both = cardsUnder(rowWith('d3'));
  expect(kinds(both)).toEqual(['comment thread']);
  expect(both[0].textContent).toMatch(/round 1 L3 · round 2 L3/);
  expect(kinds(cardsUnder(rowWith('c1')))).toEqual(['question thread']);
  expect(kinds(cardsUnder(rowWith('c4')))).toEqual(['question thread']);
  expect(kinds(cardsUnder(rowWith('c2')))).toEqual(['suggestion thread']);
});

// Invariant: inline, a round-A copy sits under the line carrying its old number and a round-B copy under the line
// carrying its new number, so a changed line shows the thread twice.
test('inline: the from-copy sits under the deleted line and the to-copy under the added line', () => {
  show('inline');
  expect(kinds(cardsUnder(rowWith('d3')))).toEqual(['comment thread']);
  expect(kinds(cardsUnder(rowWith('a3')))).toEqual(['comment thread']);
  expect(screen.getAllByRole('article', { name: 'comment thread' })).toHaveLength(2);
  expect(kinds(cardsUnder(rowWith('c1')))).toEqual(['question thread']);
  expect(kinds(cardsUnder(rowWith('c4')))).toEqual(['question thread']);
});

// Invariant: a context line carries both numbers, so a thread at the same unchanged line in both rounds shows once.
test('inline: a thread on the same unchanged line in both rounds shows once', () => {
  localStorage.setItem('code-review:diffView', 'inline');
  renderDiff(<FileDiff />, diffFile({ hunks: [hunk({ verdict: null })], threads: [copy('t-5', 'finding', 'from', 4), copy('t-5', 'finding', 'to', 4)] }), { compare: { from: 1, to: 2 }, readOnly: true });
  expect(kinds(cardsUnder(rowWith('c4')))).toEqual(['finding thread']);
  expect(screen.getAllByRole('article')).toHaveLength(1);
});

// Invariant: each round-A card says whether its thread went outdated by round B, and in which round.
test('the note of a round-A copy states the round it went outdated in, or that it still applies', () => {
  show('inline');
  expect(cardsUnder(rowWith('c2'))[0].textContent).toMatch(/round 1 L2 · outdated in round 2/);
  expect(cardsUnder(rowWith('c1'))[0].textContent).toMatch(/round 1 L1 · still applies in round 2/);
  expect(cardsUnder(rowWith('c4'))[0].textContent).toMatch(/round 2 L4/);
});

// Invariant: the comparison is read-only: no verdicts, no gutter selection, no reply box.
test('no verdict group, gutter selection or reply box in a comparison', () => {
  show('inline');
  expect(screen.queryByRole('group', { name: 'Hunk verdict' })).toBeNull();
  expect(document.querySelector('[data-cell]')).toBeNull();
  expect(screen.queryByLabelText('Reply')).toBeNull();
});

// Invariant: a file thread's two copies show once, in the file-threads block, noting both rounds.
test('a file thread with both copies renders once, in the file-threads block', () => {
  const fileCopy = (placement: 'from' | 'to', round: number): ComparedThread => ({
    ...thread({ id: 't-9', anchor: { kind: 'file', file: 'src/a.ts', round } }), placement, outdatedIn: null,
  });
  renderDiff(<FileDiff />, diffFile({ hunks: [hunk({ verdict: null })], threads: [fileCopy('from', 1), fileCopy('to', 2)] }), { compare: { from: 1, to: 2 }, readOnly: true });
  const block = screen.getByRole('region', { name: 'File threads' });
  expect(within(block).getAllByRole('article')).toHaveLength(1);
  expect(within(block).getByText('round 1 · round 2')).toBeTruthy();
  expect(within(screen.getByRole('grid')).queryAllByRole('article')).toHaveLength(0);
});
