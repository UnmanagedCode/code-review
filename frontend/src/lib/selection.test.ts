import { expect, test } from 'vitest';
import { buildRows, collapseRows } from './diffRows';
import { hunk, lines } from '@/test/fixtures';
import { contains, extendSelection, selectionTouches, startSelection } from './selection';

// new 1–5: c1 c2 a3 a4 c5 ; a del row (old only) sits between c2 and a3.
const h = hunk({ lines: [
  { t: 'ctx', old: 1, new: 1, text: 'c1' }, { t: 'ctx', old: 2, new: 2, text: 'c2' },
  { t: 'del', old: 3, new: null, text: 'd3' }, { t: 'add', old: null, new: 3, text: 'a3' },
  { t: 'add', old: null, new: 4, text: 'a4' }, { t: 'ctx', old: 4, new: 5, text: 'c5' },
], oldStart: 1, oldLines: 4, newStart: 1, newLines: 5 });
const rows = buildRows({ hunks: [h], expansions: {}, texts: {}, total: 5 });

test('a single line selects itself on the touched side; a ctx row picked via the old gutter is side old', () => {
  expect(startSelection('new', 3)).toEqual({ side: 'new', start: 3, end: 3, anchorLine: 3 });
  expect(startSelection('old', 4)).toMatchObject({ side: 'old', start: 4, end: 4 });
});

test('dragging extends over the chosen side only (deleted rows are not part of a new-side range)', () => {
  const sel = extendSelection(rows, startSelection('new', 2), 4);
  expect(sel).toMatchObject({ side: 'new', start: 2, end: 4 });
  expect(contains(sel, 'new', 3)).toBe(true);
  expect(contains(sel, 'old', 3)).toBe(false);
});

test('shift-extend works from the anchor, and a backwards drag normalises start ≤ end', () => {
  const first = extendSelection(rows, startSelection('new', 4), 2);
  expect(first).toMatchObject({ start: 2, end: 4, anchorLine: 4 });
  expect(extendSelection(rows, first, 5)).toMatchObject({ start: 4, end: 5, anchorLine: 4 });
});

const far = hunk({ id: 'z', oldStart: 21, oldLines: 2, newStart: 21, newLines: 2, lines: lines('c21 c22').map((l, i) => ({ ...l, old: 21 + i, new: 21 + i })) });

test('the selection clamps at a collapsed gap', () => {
  const r = buildRows({ hunks: [h, far], expansions: {}, texts: {}, total: 30 });
  const sel = extendSelection(r, startSelection('new', 5), 22);
  expect(sel).toMatchObject({ start: 5, end: 5 });
});

test('anchored at line 2 and dragged to line 22 across a collapsed gap, the range ends at 5', () => {
  const r = buildRows({ hunks: [h, far], expansions: {}, texts: {}, total: 30 });
  expect(extendSelection(r, startSelection('new', 2), 22)).toMatchObject({ start: 2, end: 5, anchorLine: 2 });
});

test('once the gap is expanded the range spans both hunks', () => {
  const texts = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [i + 1, 'x']));
  const r = buildRows({ hunks: [h, far], expansions: { 'after:h1': { top: 15, bottom: 0 } }, texts, total: 30 });
  expect(extendSelection(r, startSelection('new', 5), 22)).toMatchObject({ start: 5, end: 22 });
});

test('a target line that is not rendered leaves the selection unchanged', () => {
  const sel = startSelection('new', 2);
  expect(extendSelection(rows, sel, 99)).toBe(sel);
});

// Invariant: a selection never covers hidden lines.
test('the selection stops before a collapsed hunk and crosses an expanded one', () => {
  const texts = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [i + 1, 'x']));
  const r = buildRows({ hunks: [h, far], expansions: { 'after:h1': { top: 15, bottom: 0 }, 'after:z': { top: 8, bottom: 0 } }, texts, total: 30 });
  expect(extendSelection(r, startSelection('new', 18), 25)).toMatchObject({ start: 18, end: 25 });
  const hidden = collapseRows(r, (id) => id === 'z');
  expect(extendSelection(hidden, startSelection('new', 18), 25)).toMatchObject({ start: 18, end: 20 });
  expect(extendSelection(hidden, startSelection('new', 25), 18)).toMatchObject({ start: 23, end: 25 });
});

// Invariant: the keep-open and target predicates match a range on its own side only.
test('selectionTouches is true when any line on the selection side falls in the range', () => {
  const del = h.lines.filter((l) => l.t === 'del');
  expect(selectionTouches({ side: 'old', start: 3, end: 3, anchorLine: 3 }, del)).toBe(true);
  expect(selectionTouches({ side: 'new', start: 3, end: 3, anchorLine: 3 }, del)).toBe(false);
  expect(selectionTouches({ side: 'new', start: 4, end: 9, anchorLine: 4 }, h.lines)).toBe(true);
  expect(selectionTouches({ side: 'new', start: 6, end: 9, anchorLine: 6 }, h.lines)).toBe(false);
  expect(selectionTouches(null, h.lines)).toBe(false);
});
