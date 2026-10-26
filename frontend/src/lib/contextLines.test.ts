import { expect, test } from 'vitest';
import { hunk, lines } from '@/test/fixtures';
import { contextBaseline, trimContext } from './contextLines';
import { buildRows, gapSpans } from './diffRows';
import type { Hunk, TextHunk } from './types';

// Three git -U3 hunks of a 45-line file (new side): h1 at old/new 5–11, a pure insertion h2, and h3 with context between two changes.
const h1 = hunk({ id: 'h1', header: '@@ -5,7 +5,7 @@', oldStart: 5, oldLines: 7, newStart: 5, newLines: 7, lines: lines('c1 c2 c3 d4 a4 c5 c6 c7').map((l) => ({ ...l, old: l.old && l.old + 4, new: l.new && l.new + 4 })) });
// A pure insertion: old 19–24 (context only), new 19–26.
const ins = hunk({ id: 'h2', header: '@@ -19,6 +19,8 @@', oldStart: 19, oldLines: 6, newStart: 19, newLines: 8, lines: lines('c1 c2 c3 a4 a5 c4 c5 c6').map((l) => ({ ...l, old: l.old && l.old + 18, new: l.new && l.new + 18 })) });
// Interior context between two changes inside one hunk.
const inner = hunk({ id: 'h3', header: '@@ -30,9 +32,9 @@', oldStart: 30, oldLines: 9, newStart: 32, newLines: 9, lines: lines('c1 c2 c3 d4 a4 c5 d6 a6 c7 c8 c9').map((l) => ({ ...l, old: l.old && l.old + 29, new: l.new && l.new + 31 })) });
const hunks: Hunk[] = [h1, ins, inner];
const T = (h: Hunk) => h as TextHunk;
const coords = (h: Hunk) => { const t = T(h); return [t.oldStart, t.oldLines, t.newStart, t.newLines]; };

test('trimContext at n = 0, 1, 2 gives git -U<n> coordinates for edge context, including a 0-line side', () => {
  // Invariant: the trimmed hunk's coordinates are what git -U<n> would print, so gap spans line up with the kept lines.
  const at = (n: number) => trimContext(hunks, n, { keepTail: true }).hunks.map(coords);
  expect(at(0)).toEqual([[8, 1, 8, 1], [21, 0, 22, 2], [33, 3, 35, 3]]);
  expect(at(1)).toEqual([[7, 3, 7, 3], [21, 2, 21, 4], [32, 5, 34, 5]]);
  expect(at(2)).toEqual([[6, 5, 6, 5], [20, 4, 20, 6], [31, 7, 33, 7]]);
  expect(trimContext(hunks, 3, { keepTail: true }).hunks).toBe(hunks);
});

test('every trimmed line reappears in exactly one gap span, and buildRows gives it its seeded text', () => {
  // Invariant: trimming moves lines into gaps, never loses or duplicates one, and a reopened trimmed line shows its text without a fetch.
  for (const n of [0, 1, 2]) {
    const { hunks: shown, seeded } = trimContext(hunks, n, { keepTail: true });
    const spans = gapSpans(shown, 45);
    for (const k of Object.keys(seeded).map(Number)) expect(spans.filter((s) => s.from <= k && k <= s.to)).toHaveLength(1);
    const kept = new Set(shown.flatMap((h) => h.lines.flatMap((l) => (l.new == null ? [] : [l.new]))));
    const cut = hunks.flatMap((h) => h.lines.flatMap((l) => (l.new == null || kept.has(l.new) ? [] : [l.new])));
    expect(Object.keys(seeded).map(Number).sort((a, b) => a - b)).toEqual(cut);
    const all = Object.fromEntries(spans.map((s) => [s.gapKey, { top: s.to - s.from + 1, bottom: 0 }]));
    const rows = buildRows({ hunks: shown, expansions: all, texts: seeded, total: 45 });
    for (const [k, text] of Object.entries(seeded)) {
      const row = rows.find((r) => r.kind === 'line' && r.line.new === Number(k));
      expect(row?.kind === 'line' && row.line.text).toBe(text);
    }
    // Every new line has exactly one row.
    const seen = rows.flatMap((r) => (r.kind === 'line' && r.line.new != null ? [r.line.new] : []));
    expect(seen).toEqual(Array.from({ length: 45 }, (_, i) => i + 1));
  }
});

test('interior context is kept; with keepTail false the last hunk keeps its trailing context; ids are unchanged', () => {
  // Invariant: a verdict's hunk never loses lines between its changes, and lines with no trailing gap yet never vanish.
  const zero = trimContext(hunks, 0, { keepTail: true }).hunks;
  expect(T(zero[2]).lines.map((l) => l.text)).toEqual(['d4', 'a4', 'c5', 'd6', 'a6']);
  expect(zero.map((h) => h.id)).toEqual(['h1', 'h2', 'h3']);
  const held = trimContext(hunks, 0, { keepTail: false }).hunks;
  expect(T(held[2]).lines.map((l) => l.text)).toEqual(['d4', 'a4', 'c5', 'd6', 'a6', 'c7', 'c8', 'c9']);
  expect(coords(held[2])).toEqual([33, 6, 35, 6]);
  expect(T(held[0]).lines.map((l) => l.text)).toEqual(['d4', 'a4']);
});

test('contextBaseline at n = 5 opens 2 per hunk-touching edge, clamped to the gap; nothing at n ≤ 3', () => {
  // Invariant: more context than git's opens exactly n − 3 lines beside each hunk and never past a gap.
  expect(contextBaseline(hunks, 45, 5)).toEqual({ pre: { top: 0, bottom: 2 }, 'after:h1': { top: 2, bottom: 2 }, 'after:h2': { top: 2, bottom: 2 }, 'after:h3': { top: 2, bottom: 0 } });
  // Total unknown: no trailing gap yet.
  expect(contextBaseline(hunks, null, 5)['after:h3']).toBeUndefined();
  // h1 ends at 11 and ins starts at 19: a 7-line gap; at 25 both edges together open all of it.
  const wide = contextBaseline(hunks, 45, 25);
  expect(wide['after:h1']).toEqual({ top: 7, bottom: 0 });
  for (const n of [0, 1, 3]) expect(contextBaseline(hunks, 45, n)).toEqual({});
});
