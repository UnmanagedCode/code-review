import { expect, test } from 'vitest';
import { hunk } from '@/test/fixtures';
import { decorateRows } from './decorate';
import { buildRows, type Row } from './diffRows';
import { TOKEN_CLASS } from './highlight';
import { tokenize } from './highlight/prism';
import { splitRows } from './splitRows';
import type { DiffLine, Hunk } from './types';
import { WORD_DIFF_MAX_TOTAL_CELLS, wordDiffCells } from './wordDiff';

const L = (t: DiffLine['t'], old: number | null, nu: number | null, text: string): DiffLine => ({ t, old, new: nu, text });
const lineRows = (rows: Row[]) => rows.flatMap((r) => (r.kind === 'line' ? [r.line] : []));
const text = (segs: { text: string }[] | undefined) => segs?.map((s) => s.text).join('');
const ws = { side: 'new' as const, ignoreWhitespace: false };

const h1: Hunk = hunk({
  id: 'h1', oldStart: 1, oldLines: 4, newStart: 1, newLines: 4,
  lines: [L('ctx', 1, 1, 'const a = 1; /* opens'), L('del', 2, null, 'still comment */ let x = "old";'), L('add', null, 2, 'closes */ let x = "new";\r'), L('ctx', 3, 3, 'let y = 2;'), L('ctx', 4, 4, '<img src=x onerror=alert(1)>')],
});
const h2: Hunk = hunk({ id: 'h2', oldStart: 9, oldLines: 2, newStart: 9, newLines: 2, lines: [L('del', 9, null, 'foo(1)'), L('add', null, 9, 'foo(2)'), L('ctx', 10, 10, 'end')] });
const rows = buildRows({ hunks: [h1, h2], expansions: { 'after:h1': { top: 2, bottom: 2 } }, texts: { 5: 'g5', 6: 'g6', 7: 'g7', 8: 'g8' }, total: null });

test('for every line the segments concatenate to its text minus a trailing CR', () => {
  // Invariant: highlighting and emphasis never alter a line's content.
  for (const tk of [tokenize, null]) {
    const decos = decorateRows(rows, 'typescript', tk, ws);
    for (const l of lineRows(rows)) expect(text(decos.get(l))).toBe(l.text.replace(/\r$/, ''));
  }
});

test('deleted lines take old-side segments, added lines new-side, context the file side; a comment spanning ctx → add keeps its class', () => {
  // Invariant: each line is highlighted in the flow of its own file side, so multi-line constructs colour across rows.
  const decos = decorateRows(rows, 'typescript', tokenize, ws);
  const [ctx1, del, add] = h1.lines;
  expect(decos.get(ctx1)?.find((s) => s.text === 'const')?.cls).toBe(TOKEN_CLASS.keyword);
  // Old side: the comment opened on the ctx line continues into the deleted line.
  const comment = (l: DiffLine) => text(decos.get(l)?.filter((x) => x.cls === TOKEN_CLASS.comment));
  expect(comment(del)).toBe('still comment */');
  // New side: it continues into the added line too.
  expect(comment(add)).toBe('closes */');
  // A deleted file's context uses old-side segments.
  const del1 = L('ctx', 1, null, '/* a');
  const gone = buildRows({ hunks: [hunk({ lines: [L('del', 1, null, '/* a'), L('del', 2, null, 'b */ let')] })], expansions: {}, texts: {}, total: null, side: 'old' });
  const goneDecos = decorateRows([...gone, { kind: 'line', key: 'x', hunkId: null, line: del1 }], 'typescript', tokenize, { side: 'old', ignoreWhitespace: false });
  expect(goneDecos.get(del1)?.[0].cls).toBe(TOKEN_CLASS.comment);
});

test('emphasis pairs the n-th deletion with the n-th addition of one run, never across context, a hunk or a gap', () => {
  // Invariant: word emphasis compares only the lines split view shows side by side.
  const decos = decorateRows(rows, null, null, ws);
  const em = (l: DiffLine) => decos.get(l)?.filter((s) => s.em).map((s) => s.text);
  expect(em(h1.lines[1])).toEqual(['still comment', 'old']);
  expect(em(h2.lines[0])).toEqual(['1']);
  expect(em(h2.lines[1])).toEqual(['2']);
  // Separated by a context line: no pairing.
  const apart = buildRows({ hunks: [hunk({ lines: [L('del', 1, null, 'foo(1)'), L('ctx', 2, 1, 'x'), L('add', null, 2, 'foo(2)')] })], expansions: {}, texts: {}, total: null });
  const d2 = decorateRows(apart, null, null, ws);
  expect(lineRows(apart).every((l) => !d2.get(l)?.some((s) => s.em))).toBe(true);
  // An unpaired extra addition gets none.
  const extra = buildRows({ hunks: [hunk({ lines: [L('del', 1, null, 'a b'), L('add', null, 1, 'a c'), L('add', null, 2, 'zzz')] })], expansions: {}, texts: {}, total: null });
  const d3 = decorateRows(extra, null, null, ws);
  expect(d3.get(lineRows(extra)[2])?.some((s) => s.em)).toBe(false);
  expect(d3.get(lineRows(extra)[1])?.some((s) => s.em)).toBe(true);
});

test('a split pair resolves both halves to the same entries as the inline rows', () => {
  // Invariant: one decoration lookup by line object serves inline rows and both split halves.
  const decos = decorateRows(rows, 'typescript', tokenize, ws);
  for (const p of splitRows(rows)) {
    if (p.kind !== 'pair') continue;
    for (const l of [p.left, p.right]) if (l) expect(decos.get(l)).toBeDefined();
  }
  expect(splitRows(rows).flatMap((p) => (p.kind === 'pair' ? [p.left, p.right] : [])).filter(Boolean).every((l) => lineRows(rows).includes(l!))).toBe(true);
});

test('word emphasis stops once WORD_DIFF_MAX_TOTAL_CELLS is spent: later pairs get none, in row order', () => {
  // Invariant: one decoration's word-diff work is bounded, however many pairs the file has.
  const del = 'const value = compute(alpha, beta, 1);';
  const add = 'const value = compute(alpha, gamma, 2);';
  const per = wordDiffCells(del, add);
  const fit = Math.floor(WORD_DIFF_MAX_TOTAL_CELLS / per);
  const pairs = fit + 50;
  // Each pair its own run (context between), as in a file rewritten line by line.
  const many = hunk({ lines: Array.from({ length: pairs }, (_, i) => [L('del', 2 * i + 1, null, del), L('add', null, 2 * i + 1, add), L('ctx', 2 * i + 2, 2 * i + 2, 'x')]).flat() });
  const built = buildRows({ hunks: [many], expansions: {}, texts: {}, total: null });
  const decos = decorateRows(built, null, null, ws);
  const emphasised = lineRows(built).filter((l) => l.t === 'add').map((l) => decos.get(l)!.some((s) => s.em));
  expect(emphasised.slice(0, fit).every(Boolean)).toBe(true);
  expect(emphasised.slice(fit).some(Boolean)).toBe(false);
  // Every line still renders its text.
  for (const l of lineRows(built)) expect(text(decos.get(l))).toBe(l.text);
});

test('wordDiffCells counts the LCS table and a fixed setup, and 0 for a pair past the per-line caps', () => {
  // Invariant: the budget charges what wordDiff actually does, and nothing for pairs it skips at once.
  expect(wordDiffCells('a b', 'a')).toBeGreaterThan(wordDiffCells('a', 'a'));
  expect(wordDiffCells('x'.repeat(2000), 'y')).toBe(0);
  expect(wordDiffCells('', '')).toBeGreaterThan(0);
});
