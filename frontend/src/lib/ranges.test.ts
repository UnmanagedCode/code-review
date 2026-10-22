import { expect, test } from 'vitest';
import { thread } from '@/test/fixtures';
import { lineSpan, MAX_LANES, markNote, rangeLabel, rangeMarks } from './ranges';
import type { Side, Thread, ThreadKind } from './types';

const at = (id: string, side: Side, startLine: number, endLine: number, over: Partial<Thread> = {}) =>
  thread({ id, ...over, anchor: { ...thread().anchor, side, startLine, endLine } });
const lanesOf = (look: ReturnType<typeof rangeMarks>, side: Side, lines: number[]) =>
  Object.fromEntries(lines.flatMap((n) => look(side, n).map((m) => [`${m.threadId}@${n}`, m.lane])));

// Invariant: a thread marks every line of its range on its side, and no line outside it (no off-by-one at either end).
test('a range marks every line from start to end and nothing around it', () => {
  const look = rangeMarks([at('t-1', 'new', 3, 5)]);
  expect([2, 3, 4, 5, 6].map((n) => look('new', n).length)).toEqual([0, 1, 1, 1, 0]);
  expect([3, 4, 5].map((n) => { const [m] = look('new', n); return [m.first, m.last]; })).toEqual([[true, false], [false, false], [false, true]]);
});

// Invariant: a single-line range is one mark that both starts and ends the range.
test('a single-line anchor marks exactly one line, as both first and last', () => {
  const look = rangeMarks([at('t-1', 'new', 4, 4)]);
  expect([3, 4, 5].map((n) => look('new', n).length)).toEqual([0, 1, 0]);
  expect(look('new', 4)[0]).toMatchObject({ first: true, last: true });
});

// Invariant: a mark lives on its anchor's side only; the same numbers on the other side stay unmarked.
test('an old-side anchor marks only old lines and a new-side anchor only new lines', () => {
  const look = rangeMarks([at('t-o', 'old', 3, 4), at('t-n', 'new', 7, 8)]);
  expect(look('old', 3).map((m) => m.threadId)).toEqual(['t-o']);
  expect(look('new', 3)).toEqual([]);
  expect(look('new', 7).map((m) => m.threadId)).toEqual(['t-n']);
  expect(look('old', 7)).toEqual([]);
});

// Invariant: two ranges that overlap or touch never share a lane, so each stays distinguishable; separated ranges reuse lane 0.
test('overlapping and touching ranges get different lanes; ranges two lines apart share lane 0', () => {
  const overlap = rangeMarks([at('a', 'new', 3, 6), at('b', 'new', 5, 8)]);
  expect(overlap('new', 5).map((m) => m.lane)).toEqual([0, 1]);
  const touch = rangeMarks([at('a', 'new', 3, 5), at('b', 'new', 6, 8)]);
  expect(lanesOf(touch, 'new', [5, 6])).toEqual({ 'a@5': 0, 'b@6': 1 });
  const apart = rangeMarks([at('a', 'new', 3, 5), at('b', 'new', 7, 8)]);
  expect(lanesOf(apart, 'new', [5, 7])).toEqual({ 'a@5': 0, 'b@7': 0 });
});

// Invariant: lanes depend only on the set of threads, not their order, and threads past MAX_LANES still mark, in the last lane.
test('lanes are independent of input order and deep overlaps share the last lane', () => {
  const ts = [at('a', 'new', 1, 10), at('b', 'new', 2, 9), at('c', 'new', 3, 8), at('d', 'new', 4, 7), at('e', 'new', 5, 6)];
  const lines = Array.from({ length: 10 }, (_, i) => i + 1);
  const lanes = lanesOf(rangeMarks(ts), 'new', lines);
  expect(lanesOf(rangeMarks([...ts].reverse()), 'new', lines)).toEqual(lanes);
  expect(lanesOf(rangeMarks([ts[2], ts[4], ts[0], ts[3], ts[1]]), 'new', lines)).toEqual(lanes);
  expect(rangeMarks(ts)('new', 5).map((m) => [m.threadId, m.lane])).toEqual([['a', 0], ['b', 1], ['c', 2], ['d', MAX_LANES - 1], ['e', MAX_LANES - 1]]);
});

// Invariant: an outdated thread's anchor is a past location, so it marks nothing.
test('outdated threads are never marked', () => {
  const look = rangeMarks([at('t-1', 'new', 3, 5, { status: 'outdated' })]);
  expect([3, 4, 5].flatMap((n) => look('new', n))).toEqual([]);
});

// Invariant: only the routed thread is active; status does not change whether or how a thread is marked.
test('only the active thread is marked active, and resolved threads are marked like open ones', () => {
  const look = rangeMarks([at('t-1', 'new', 3, 3), at('t-2', 'new', 3, 3, { status: 'resolved' })], 't-2');
  expect(look('new', 3).map((m) => [m.threadId, m.active])).toEqual([['t-1', false], ['t-2', true]]);
  expect(rangeMarks([at('t-2', 'new', 3, 3, { status: 'resolved' })])('new', 3)).toHaveLength(1);
});

// Invariant: in a round comparison the from-copy (old = round A) and the to-copy (new = round B) of one thread each mark their own side only.
test('a comparison thread marks its round-A copy on old and its round-B copy on new', () => {
  const look = rangeMarks([at('t-1', 'old', 3, 3), at('t-1', 'new', 4, 4)]);
  const marked = (side: Side) => [1, 2, 3, 4, 5].filter((n) => look(side, n).length);
  expect(marked('old')).toEqual([3]);
  expect(marked('new')).toEqual([4]);
});

// Invariant: one label format names a range everywhere (cards, the selection composer, the gutter's accessible name).
test('labels name the lines and the side, and markNote joins the marks it is given', () => {
  expect(lineSpan(3, 3)).toBe('L3');
  expect(lineSpan(3, 5)).toBe('L3–L5');
  expect(rangeLabel({ side: 'new', startLine: 3, endLine: 3 })).toBe('L3 (new)');
  expect(rangeLabel({ side: 'old', startLine: 3, endLine: 5 })).toBe('L3–L5 (old)');
  const kind: ThreadKind = 'question';
  const look = rangeMarks([at('t-1', 'new', 3, 5, { kind }), at('t-2', 'new', 4, 4)]);
  expect(look('new', 4)[0].label).toBe('question thread L3–L5 (new)');
  expect(markNote(look('new', 4))).toBe(' · in question thread L3–L5 (new), comment thread L4 (new)');
  expect(markNote([])).toBe('');
});
