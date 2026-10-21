import { fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, expect, test } from 'vitest';
import { WIDE_QUERY } from '@/lib/useMediaQuery';
import { installMedia } from '@/test/fakeMedia';
import { installResizeObserver } from '@/test/fakeResizeObserver';
import { diffFile, hunk, thread } from '@/test/fixtures';
import { renderDiff } from '@/test/renderCtx';
import { FileDiff } from './FileDiff';
import { SPLIT_EXIT_SLACK_PX, SPLIT_MIN_PX } from './useDiffView';

// Default fixture hunk: c1 c2 d3 a3 c4 (old 1–4, new 1–4).
let ro: ReturnType<typeof installResizeObserver>;
let media: ReturnType<typeof installMedia>;
beforeEach(() => {
  media = installMedia({ [WIDE_QUERY]: true });
  ro = installResizeObserver();
  history.replaceState(null, '', '?file=src%2Fa.ts');
});

const rowWith = (text: string) => screen.getAllByRole('row').find((r) => within(r).queryByText(text));
const isSplit = () => !!within(rowWith('d3')!).queryByText('a3');
const rowOf = (name: string) => screen.getByRole('gridcell', { name }).closest('[role="row"]')!;
const gutterNames = () => screen.queryAllByRole('gridcell', { name: /^(old|new) line \d+$/ }).map((c) => c.getAttribute('aria-label')).sort();
const show = (ui = <FileDiff />, file = diffFile(), over = {}, total: number | null = null, width = 1000) => {
  const r = renderDiff(ui, file, over, total);
  ro.resize('all', width);
  return r;
};

// Invariant: inline is the default.
test('with nothing stored the diff is inline', () => {
  show();
  expect(screen.getByRole('button', { name: 'Inline' }).getAttribute('aria-pressed')).toBe('true');
  expect(isSplit()).toBe(false);
});

// Invariant: the toggle switches the view and records the choice.
test('Split pairs the deleted and added lines in one row and is remembered', () => {
  show();
  fireEvent.click(screen.getByRole('button', { name: 'Split' }));
  expect(isSplit()).toBe(true);
  expect(screen.getByRole('button', { name: 'Split' }).getAttribute('aria-pressed')).toBe('true');
  expect(localStorage.getItem('code-review:diffView')).toBe('split');
});

// Invariant: the choice persists across reloads; unknown stored values fall back to inline.
test.each([['split', true], ['x', false]])('a stored %s renders split=%s on a fresh mount', (stored, split) => {
  localStorage.setItem('code-review:diffView', stored);
  show();
  expect(isSplit()).toBe(split);
});

// Invariant: the fallback keys off the diff pane's observed width, reacts live, is view-only and reversible.
test('a narrow pane falls back to inline without touching the stored choice', () => {
  localStorage.setItem('code-review:diffView', 'split');
  show(undefined, undefined, undefined, null, 800);
  expect(isSplit()).toBe(true);
  ro.resize('all', 500);
  expect(isSplit()).toBe(false);
  expect(screen.queryByRole('group', { name: 'Diff view' })).toBeNull();
  expect(localStorage.getItem('code-review:diffView')).toBe('split');
  ro.resize('all', 800);
  expect(isSplit()).toBe(true);
});

// Invariant: the boundary is inclusive at the single SPLIT_MIN_PX.
test('split starts exactly at SPLIT_MIN_PX', () => {
  localStorage.setItem('code-review:diffView', 'split');
  show(undefined, undefined, undefined, null, SPLIT_MIN_PX - 1);
  expect(isSplit()).toBe(false);
  ro.resize('all', SPLIT_MIN_PX);
  expect(isSplit()).toBe(true);
});

// Invariant: once split, the view leaves it only below SPLIT_MIN_PX − SPLIT_EXIT_SLACK_PX, so a width jitter
// near the threshold (a scrollbar appearing as split changes the content height) can't flip it back and forth.
test('split has hysteresis: it enters at SPLIT_MIN_PX and leaves only below the exit slack', () => {
  localStorage.setItem('code-review:diffView', 'split');
  show(undefined, undefined, undefined, null, SPLIT_MIN_PX);
  expect(isSplit()).toBe(true);
  ro.resize('all', SPLIT_MIN_PX - SPLIT_EXIT_SLACK_PX);
  expect(isSplit()).toBe(true);
  ro.resize('all', SPLIT_MIN_PX - SPLIT_EXIT_SLACK_PX - 1);
  expect(isSplit()).toBe(false);
  ro.resize('all', SPLIT_MIN_PX - 1);
  expect(isSplit()).toBe(false);
  ro.resize('all', SPLIT_MIN_PX);
  expect(isSplit()).toBe(true);
});

// Invariant: a new-comment draft survives a view flip (the composer remounts under a differently keyed row).
test('the composer keeps its draft when the view flips', () => {
  show();
  fireEvent.pointerDown(screen.getByRole('gridcell', { name: 'new line 3' }), { button: 0, buttons: 1, pointerType: 'mouse' });
  fireEvent.pointerUp(window);
  fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'not sent yet' } });
  fireEvent.click(screen.getByRole('button', { name: 'Split' }));
  expect(isSplit()).toBe(true);
  expect((screen.getByLabelText('Message') as HTMLTextAreaElement).value).toBe('not sent yet');
  fireEvent.click(screen.getByRole('button', { name: 'Inline' }));
  expect((screen.getByLabelText('Message') as HTMLTextAreaElement).value).toBe('not sent yet');
});

// Invariant: the phone layout never splits, whatever its pane width.
test('the phone layout stays inline with no toggle until the wide layout returns', () => {
  media.set(WIDE_QUERY, false);
  localStorage.setItem('code-review:diffView', 'split');
  show();
  expect(isSplit()).toBe(false);
  expect(screen.queryByRole('group', { name: 'Diff view' })).toBeNull();
  media.set(WIDE_QUERY, true);
  expect(isSplit()).toBe(true);
});

// Invariant: the first paint is never a split flash on an unmeasured pane.
test('before the pane is measured the diff is inline', () => {
  localStorage.setItem('code-review:diffView', 'split');
  renderDiff(<FileDiff />, diffFile());
  expect(isSplit()).toBe(false);
});

// Invariant: the toggle is for text diffs only.
test('a binary file has no view toggle', () => {
  history.replaceState(null, '', '?file=img.png');
  show(undefined, diffFile({ path: 'img.png', binary: true, hunks: [{ id: 'f1', kind: 'file', lines: [], verdict: 'pending' }] }));
  expect(screen.queryByRole('group', { name: 'Diff view' })).toBeNull();
});

// Invariant: split allows exactly the anchors inline does.
test.each([[false], [true]])('split offers the same selectable gutter cells as inline (readOnly=%s)', (readOnly) => {
  show(undefined, undefined, { readOnly });
  const inline = gutterNames();
  fireEvent.click(screen.getByRole('button', { name: 'Split' }));
  expect(isSplit()).toBe(true);
  expect(gutterNames()).toEqual(inline);
  if (readOnly) expect(inline).toEqual([]);
  else expect(inline.length).toBeGreaterThan(0);
});

// Invariant: threads appear at the same lines in both views.
test.each(['inline', 'split'])('threads follow the row holding their end line (%s)', (view) => {
  localStorage.setItem('code-review:diffView', view);
  const at = (id: string, kind: 'comment' | 'question' | 'suggestion' | 'finding', side: 'old' | 'new', n: number) =>
    thread({ id, kind, anchor: { ...thread().anchor, side, startLine: n, endLine: n } });
  const threads = [at('t-1', 'comment', 'old', 3), at('t-2', 'question', 'new', 3), at('t-3', 'suggestion', 'new', 4), at('t-4', 'finding', 'old', 2)];
  show(undefined, diffFile({ threads }));
  expect(isSplit()).toBe(view === 'split');
  const rows = screen.getAllByRole('row');
  for (const [kind, cell] of [['comment', 'old line 3'], ['question', 'new line 3'], ['suggestion', 'new line 4'], ['finding', 'old line 2']]) {
    const row = rowOf(cell);
    const next = rows[rows.indexOf(row as HTMLElement) + 1];
    const card = screen.getByRole('article', { name: `${kind} thread` });
    expect(row.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    if (next) expect(next.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  }
});

// Invariant: the left column anchors the old side, the right column the new side.
test.each([['new', 'L3 (new)'], ['old', 'L3 (old)']])('in split a drag on the %s gutter comments on that side', (side, label) => {
  localStorage.setItem('code-review:diffView', 'split');
  show();
  const cell = screen.getByRole('gridcell', { name: `${side} line 3` });
  fireEvent.pointerDown(cell, { button: 0, buttons: 1, pointerType: 'mouse' });
  fireEvent.pointerUp(window);
  const form = screen.getByRole('form', { name: `Comment on ${label}` });
  expect(cell.closest('[role="row"]')!.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

// Invariant: ←/→ side-switching is the same as inline.
test('in split ←/→ switches sides on context and stays put on a deleted line', () => {
  localStorage.setItem('code-review:diffView', 'split');
  show();
  const old2 = screen.getByRole('gridcell', { name: 'old line 2' });
  old2.focus();
  fireEvent.keyDown(old2, { key: 'ArrowRight' });
  expect(document.activeElement).toBe(screen.getByRole('gridcell', { name: 'new line 2' }));
  const old3 = screen.getByRole('gridcell', { name: 'old line 3' });
  old3.focus();
  fireEvent.keyDown(old3, { key: 'ArrowRight' });
  expect(document.activeElement).toBe(old3);
});

// Invariant: gap expansion works in split.
test('a gap in split expands through the file diff', () => {
  localStorage.setItem('code-review:diffView', 'split');
  const { value } = show(undefined, undefined, undefined, 10);
  expect(isSplit()).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
  expect(value.fileDiff.expand).toHaveBeenCalledWith('after:h1', 'all');
});

// Invariant: split cells render data as text.
test('split line text that looks like markup stays text', () => {
  localStorage.setItem('code-review:diffView', 'split');
  const h = hunk({ lines: [{ t: 'add', old: null, new: 1, text: '<script>alert(1)</script>' }], oldStart: 0, oldLines: 0, newStart: 1, newLines: 1 });
  const { container } = show(undefined, diffFile({ hunks: [h] }));
  expect(container.querySelector('script')).toBeNull();
  expect(screen.getByText('<script>alert(1)</script>')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Split' }).getAttribute('aria-pressed')).toBe('true');
});
