import { expect, test } from 'vitest';
import { hunk } from '@/test/fixtures';
import { buildRows, collapseRows } from './diffRows';
import type { DiffLine, FileHunk, Hunk, TextHunk } from './types';
import { ignoreWhitespace, isWhitespaceOnly, WS_MAX_CELLS } from './whitespace';

const L = (t: DiffLine['t'], old: number | null, nu: number | null, text: string, noEol?: boolean): DiffLine => ({ t, old, new: nu, text, ...(noEol ? { noEol } : {}) });
const text = (h: Hunk) => h as TextHunk;
const numbers = (lines: DiffLine[], side: 'old' | 'new') => lines.flatMap((l) => (l[side] == null ? [] : [l[side]]));

// A re-indented pair (old 2 / new 2), a real change (old 3 → new 3), an added blank line (new 4).
const mixed = hunk({
  id: 'hm', oldStart: 1, oldLines: 4, newStart: 1, newLines: 5, header: '@@ -1,4 +1,5 @@',
  lines: [L('ctx', 1, 1, 'a'), L('del', 2, null, 'if (x) {'), L('del', 3, null, 'one();'), L('add', null, 2, '    if (x) {'), L('add', null, 3, 'two();'), L('add', null, 4, ''), L('ctx', 4, 5, '}')],
});

test('a re-indented pair becomes one context row with both numbers and the new text', () => {
  // Invariant: a whitespace-only pair renders once, as context, and keeps both line numbers.
  const [out] = ignoreWhitespace([mixed]).map(text);
  expect(out.lines).toContainEqual({ t: 'ctx', old: 2, new: 2, text: '    if (x) {' });
  expect(out.lines.filter((l) => l.t !== 'ctx').map((l) => [l.t, l.old ?? l.new])).toEqual([['del', 3], ['add', 3], ['add', 4]]);
});

test('old numbers and new numbers are each preserved, once each, and strictly increasing', () => {
  // Invariant: every old and new line number keeps exactly one row in order, so thread keys, rails and selection still find them.
  const many = hunk({
    lines: [L('del', 1, null, 'x'), L('del', 2, null, ' a'), L('del', 3, null, 'b'), L('del', 4, null, 'c '), L('add', null, 1, 'a'), L('add', null, 2, 'y'), L('add', null, 3, 'c'), L('add', null, 4, 'z')],
    oldStart: 1, oldLines: 4, newStart: 1, newLines: 4,
  });
  for (const h of [mixed, many]) {
    const [out] = ignoreWhitespace([h]).map(text);
    for (const side of ['old', 'new'] as const) expect(numbers(out.lines, side)).toEqual(numbers(h.lines, side));
  }
});

test('ids, verdicts, coordinates and headers are unchanged, and file hunks pass through', () => {
  // Invariant: the transform is display-only: it never changes what a verdict or anchor refers to.
  const file: FileHunk = { id: 'f1', kind: 'file', lines: [], verdict: 'accepted' };
  const [out, f] = ignoreWhitespace([{ ...mixed, verdict: 'rejected' }, file]);
  const { lines: _a, ...rest } = text(out);
  const { lines: _b, ...was } = { ...mixed, verdict: 'rejected' };
  expect(rest).toEqual(was);
  expect(f).toBe(file);
  const plain = hunk();
  expect(ignoreWhitespace([plain])[0]).toBe(plain);
});

test('isWhitespaceOnly holds only when every change was whitespace', () => {
  // Invariant: only a hunk with no change left collapses as whitespace only.
  const ws = hunk({ lines: [L('ctx', 1, 1, 'a'), L('del', 2, null, 'b'), L('add', null, 2, '\tb'), L('ctx', 3, 3, 'c')] });
  expect(isWhitespaceOnly(ignoreWhitespace([ws])[0])).toBe(true);
  expect(isWhitespaceOnly(ignoreWhitespace([mixed])[0])).toBe(false);
  expect(isWhitespaceOnly(ws)).toBe(false);
  expect(isWhitespaceOnly({ id: 'f', kind: 'file', lines: [], verdict: null })).toBe(false);
});

test('an added blank line and a noEol-only difference stay changes', () => {
  // Invariant: Ignore whitespace follows git -w: blank lines and the end-of-file newline still count.
  const blank = hunk({ lines: [L('ctx', 1, 1, 'a'), L('add', null, 2, '   '), L('ctx', 2, 3, 'b')] });
  expect(ignoreWhitespace([blank])[0]).toBe(blank);
  const eol = hunk({ lines: [L('del', 1, null, 'a', true), L('add', null, 1, 'a')] });
  expect(ignoreWhitespace([eol])[0]).toBe(eol);
});

test('a run over WS_MAX_CELLS is left as it is', () => {
  // Invariant: the quadratic pairing is bounded.
  const side = Math.ceil(Math.sqrt(WS_MAX_CELLS)) + 1;
  const dels = Array.from({ length: side }, (_, i) => L('del', i + 1, null, `x${i}`));
  const adds = Array.from({ length: side }, (_, i) => L('add', null, i + 1, ` x${i}`));
  const big = hunk({ lines: [...dels, ...adds] });
  expect(ignoreWhitespace([big])[0]).toBe(big);
});

test('collapseRows still drops exactly a transformed hunk\'s lines', () => {
  // Invariant: a hunk row carries its transformed lines, so collapsing removes exactly those and keeps what follows.
  const shown = ignoreWhitespace([mixed, hunk({ id: 'h2', oldStart: 10, oldLines: 4, newStart: 11, newLines: 4, lines: [L('ctx', 10, 11, 'p'), L('del', 11, null, 'q'), L('add', null, 12, 'r'), L('ctx', 12, 13, 's')] })]);
  const rows = buildRows({ hunks: shown, expansions: {}, texts: {}, total: null });
  const out = collapseRows(rows, (id) => id === 'hm');
  expect(out.map((r) => r.key)).toEqual(['h:hm', 'after:hm@0', 'h:h2', 'h2:0', 'h2:1', 'h2:2', 'h2:3']);
});
