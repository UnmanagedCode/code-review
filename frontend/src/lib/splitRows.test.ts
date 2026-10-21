import { expect, test } from 'vitest';
import { hunk, lines } from '@/test/fixtures';
import { buildRows, type Row } from './diffRows';
import { pairLine, splitRows, type SplitRow } from './splitRows';
import type { DiffLine } from './types';

type Pair = Extract<SplitRow, { kind: 'pair' }>;
const pairs = (rows: SplitRow[]) => rows.filter((r): r is Pair => r.kind === 'pair');
const texts = (rows: SplitRow[]) => pairs(rows).map((p) => [p.left?.text ?? null, p.right?.text ?? null]);
const shift = (ls: DiffLine[], o: number, n: number) => ls.map((l) => ({ ...l, old: l.old == null ? null : l.old + o, new: l.new == null ? null : l.new + n }));
const rowsOf = (spec: string, over = {}) => buildRows({ hunks: [hunk({ lines: lines(spec), ...over })], expansions: {}, texts: {}, total: null });

// Invariant: context shows on both sides of the same row.
test('a context line becomes one pair holding the same line on both sides', () => {
  const [, p] = splitRows(rowsOf('c1'));
  expect(p).toMatchObject({ kind: 'pair' });
  expect((p as Pair).left).toBe((p as Pair).right);
});

// Invariant: the n-th deletion pairs with the n-th addition.
test('a deletion run pairs line by line with the addition run after it', () => {
  expect(texts(splitRows(rowsOf('c1 d2 d3 a2 a3 c4')))).toEqual([['c1', 'c1'], ['d2', 'a2'], ['d3', 'a3'], ['c4', 'c4']]);
});

// Invariant: unequal runs pad the short side; nothing is dropped or duplicated.
test('unequal runs pad the shorter side with empty cells', () => {
  expect(texts(splitRows(rowsOf('d1 d2 d3 a1')))).toEqual([['d1', 'a1'], ['d2', null], ['d3', null]]);
  expect(texts(splitRows(rowsOf('d1 a1 a2 a3')))).toEqual([['d1', 'a1'], [null, 'a2'], [null, 'a3']]);
});

// Invariant: added and deleted files render one-sided.
test('a pure added file has only right cells, a pure deleted file only left cells', () => {
  const added = pairs(splitRows(rowsOf('a1 a2 a3', { oldStart: 0, oldLines: 0, newStart: 1, newLines: 3 })));
  expect(added).toHaveLength(3);
  expect(added.every((p) => p.left === null && p.right?.t === 'add')).toBe(true);
  const deleted = pairs(splitRows(rowsOf('d1 d2', { oldStart: 1, oldLines: 2, newStart: 0, newLines: 0 })));
  expect(deleted).toHaveLength(2);
  expect(deleted.every((p) => p.right === null && p.left?.t === 'del')).toBe(true);
});

// Invariant: pairing never crosses a hunk or collapsed context; hunk and gap rows pass through in place.
test('runs break at context, hunk and gap rows, which pass through unchanged', () => {
  const h1 = hunk({ id: 'a', lines: lines('d1 c2 a2'), oldStart: 3, oldLines: 2, newStart: 3, newLines: 2 });
  const h2 = hunk({ id: 'b', lines: [{ t: 'add', old: null, new: 20, text: 'b-a20' }], oldStart: 18, oldLines: 0, newStart: 20, newLines: 1 });
  const rows = buildRows({ hunks: [h1, h2], expansions: {}, texts: {}, total: 30 });
  const out = splitRows(rows);
  // d1 and a2 are separated by c2: no pair joins them.
  expect(texts(out)).toEqual([['d1', null], ['c2', 'c2'], [null, 'a2'], [null, 'b-a20']]);
  for (const r of rows.filter((r) => r.kind !== 'line')) expect(out).toContain(r);
  expect(out.map((r) => r.kind)).toEqual(['gap', 'hunk', 'pair', 'pair', 'pair', 'gap', 'hunk', 'pair', 'gap']);
});

// Invariant: per-side order within a run is kept.
test('an interleaved run keeps each side in its own order', () => {
  const run: DiffLine[] = [
    { t: 'del', old: 1, new: null, text: 'a' }, { t: 'add', old: null, new: 1, text: 'b' },
    { t: 'del', old: 2, new: null, text: 'c' }, { t: 'add', old: null, new: 2, text: 'd' },
  ];
  expect(texts(splitRows(buildRows({ hunks: [hunk({ lines: run })], expansions: {}, texts: {}, total: null })))).toEqual([['a', 'b'], ['c', 'd']]);
});

// Invariant: per-side order and full coverage — what selection, keyboard and thread placement rely on.
test('every source line lands in exactly one pair, each side in flat-row order, with unique keys', () => {
  const h1 = hunk({ id: 'a', lines: shift(lines('c1 d2 d3 a2 c4 a5 d5 d6'), 10, 10), oldStart: 11, oldLines: 6, newStart: 11, newLines: 4 });
  const h2 = hunk({ id: 'b', lines: shift(lines('d1 a1 a2 c3'), 30, 30), oldStart: 31, oldLines: 2, newStart: 31, newLines: 3 });
  const textsMap = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [i + 1, `t${i + 1}`]));
  const rows = buildRows({ hunks: [h1, h2], expansions: { pre: { top: 2, bottom: 1 }, 'after:a': { top: 1, bottom: 1 } }, texts: textsMap, total: 50 });
  const out = splitRows(rows);
  const flat = rows.filter((r): r is Extract<Row, { kind: 'line' }> => r.kind === 'line');
  const ps = pairs(out);
  expect(ps.map((p) => pairLine(p, 'old')).filter((n) => n != null)).toEqual(flat.map((r) => r.line.old).filter((n) => n != null));
  expect(ps.map((p) => pairLine(p, 'new')).filter((n) => n != null)).toEqual(flat.map((r) => r.line.new).filter((n) => n != null));
  const placed = ps.flatMap((p) => (p.left === p.right ? [p.left] : [p.left, p.right])).filter(Boolean);
  expect(placed).toHaveLength(flat.length);
  expect(new Set(placed).size).toBe(flat.length);
  for (const r of flat) expect(placed).toContain(r.line);
  const keys = out.map((r) => r.key);
  expect(new Set(keys).size).toBe(keys.length);
});

// Invariant: context loading works in split.
test('expanded context lands on both sides with its own old and new numbers', () => {
  const h = hunk({ id: 'a', oldStart: 11, oldLines: 2, newStart: 11, newLines: 3, lines: [
    { t: 'ctx', old: 11, new: 11, text: 'x' }, { t: 'add', old: null, new: 12, text: 'y' }, { t: 'ctx', old: 12, new: 13, text: 'z' },
  ] });
  const rows = buildRows({ hunks: [h], expansions: { 'after:a': { top: 1, bottom: 0 } }, texts: { 14: 'ctx14' }, total: 20 });
  const p = pairs(splitRows(rows)).find((x) => x.left?.text === 'ctx14')!;
  expect(p.right).toBe(p.left);
  expect(pairLine(p, 'old')).toBe(13);
  expect(pairLine(p, 'new')).toBe(14);
});
