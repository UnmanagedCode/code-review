import { describe, expect, test } from 'vitest';
import { hunk, lines } from '@/test/fixtures';
import { buildRows, collapseRows, gapHolding, gapSpans } from './diffRows';

// Hunk 1 replaces old line 12 by new lines 12–13 (so later lines shift +1); hunk 2 sits further down.
const h1 = hunk({ id: 'a', oldStart: 11, oldLines: 3, newStart: 11, newLines: 4, lines: lines('c1 d2 a2 a3 c4').map((l, i) => ({ ...l, old: l.old == null ? null : 11 + (i > 2 ? i - 2 : i) , new: l.new == null ? null : 11 + i })) });
const h2 = hunk({ id: 'b', oldStart: 31, oldLines: 2, newStart: 32, newLines: 2 });
const base = { expansions: {}, texts: {}, total: 50 };

test('gap rows sit before the first hunk, between hunks and after the last', () => {
  const rows = buildRows({ ...base, hunks: [h1, h2] });
  const gaps = rows.filter((r) => r.kind === 'gap');
  expect(gaps.map((g) => g.kind === 'gap' && [g.gapKey, g.remaining])).toEqual([['pre', 10], ['after:a', 17], ['after:b', 17]]);
  expect(rows.map((r) => r.kind)[0]).toBe('gap');
  expect(rows.at(-1)?.kind).toBe('gap');
});

test('no trailing gap until the line count is known', () => {
  expect(gapSpans([h1], null).map((s) => s.gapKey)).toEqual(['pre']);
});

test('expanded context carries old numbers shifted by the preceding hunk offsets', () => {
  const texts = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [i + 1, `t${i + 1}`]));
  const rows = buildRows({ ...base, texts, hunks: [h1, h2], expansions: { 'after:a': { top: 2, bottom: 1 } } });
  const ctxRows = rows.filter((r) => r.kind === 'line' && r.key.startsWith('after:a:')).map((r) => r.kind === 'line' && r.line);
  // h1 ends at new 14 / old 13 → offset −1; the gap runs new 15…31.
  expect(ctxRows).toEqual([
    { t: 'ctx', old: 14, new: 15, text: 't15' },
    { t: 'ctx', old: 15, new: 16, text: 't16' },
    { t: 'ctx', old: 30, new: 31, text: 't31' },
  ]);
  const gap = rows.find((r) => r.kind === 'gap' && r.gapKey === 'after:a');
  expect(gap && gap.kind === 'gap' && gap.remaining).toBe(14);
});

test('a fully expanded gap leaves no gap row', () => {
  const rows = buildRows({ ...base, hunks: [h1], expansions: { pre: { top: 10, bottom: 0 } } });
  expect(rows.some((r) => r.kind === 'gap' && r.gapKey === 'pre')).toBe(false);
});

test('a deleted file expands on the old side', () => {
  const del = hunk({ id: 'd', oldStart: 5, oldLines: 2, newStart: 0, newLines: 0, lines: [{ t: 'del', old: 5, new: null, text: 'x' }, { t: 'del', old: 6, new: null, text: 'y' }] });
  const rows = buildRows({ hunks: [del], expansions: { pre: { top: 4, bottom: 0 } }, texts: { 1: 'a', 2: 'b', 3: 'c', 4: 'd' }, total: 8, side: 'old' });
  const first = rows[0];
  expect(first.kind === 'line' && first.line).toEqual({ t: 'ctx', old: 1, new: null, text: 'a' });
  expect(gapSpans([del], 8, 'old').map((s) => [s.gapKey, s.from, s.to])).toEqual([['pre', 1, 4], ['after:d', 7, 8]]);
});

test('gapHolding finds the span around a line and its distance from each edge', () => {
  expect(gapHolding([h1, h2], 50, 'new', 20)).toMatchObject({ gapKey: 'after:a', fromTop: 6, fromBottom: 12 });
  expect(gapHolding([h1, h2], 50, 'new', 12)).toBeNull();
});

describe('collapseRows', () => {
  const texts = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [i + 1, `t${i + 1}`]));
  const rows = buildRows({ ...base, texts, hunks: [h1, h2], expansions: { 'after:a': { top: 2, bottom: 0 } } });

  // Invariant: collapse hides exactly the hunk's own lines.
  test('marks the collapsed hunk header and drops exactly its lines, keeping the context after it and other hunks', () => {
    const out = collapseRows(rows, (id) => id === 'a');
    const header = out.find((r) => r.key === 'h:a');
    expect(header).toMatchObject({ kind: 'hunk', collapsed: true });
    expect(out.some((r) => r.kind === 'line' && r.hunkId === 'a' && !r.key.startsWith('after:'))).toBe(false);
    expect(out.filter((r) => r.key.startsWith('after:a:'))).toHaveLength(2);
    expect(out.filter((r) => r.kind === 'line' && r.key.startsWith('b:'))).toHaveLength(h2.lines.length);
    expect(out.find((r) => r.key === 'h:b')).not.toHaveProperty('collapsed', true);
    expect(out).toHaveLength(rows.length - h1.lines.length);
  });

  // Invariant: collapse is a no-op when nothing is settled.
  test('with nothing collapsed the rows are unchanged', () => {
    expect(collapseRows(rows, () => false)).toEqual(rows);
  });
});
