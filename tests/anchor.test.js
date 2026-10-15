import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linesHash, makeAnchor, locate, hunkFor } from '../src/anchor.js';

const file = (n, prefix = 'l') => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);
const anchorOn = (lines, startLine, endLine, extra = {}) =>
  makeAnchor({ file: 'f.js', side: 'new', startLine, endLine, round: 1, fileLines: lines, hunks: [], ...extra });

test('linesHash ignores trailing whitespace and CR but not leading indentation', () => {
  assert.equal(linesHash(['a  ', 'b\r']), linesHash(['a', 'b']));
  assert.notEqual(linesHash(['  a']), linesHash(['a']));
});

test('makeAnchor captures the selected text and up to 3 lines of context each side', () => {
  const a = anchorOn(file(20), 10, 11);
  assert.deepEqual(a.lines, ['l10', 'l11']);
  assert.equal(a.ctxBefore.n, 3);
  assert.equal(a.ctxAfter.n, 3);
  assert.equal(a.drifted, false);
  const edge = anchorOn(file(20), 1, 2);
  assert.equal(edge.ctxBefore.n, 0);
});

test('locate: unchanged content stays put', () => {
  const lines = file(20);
  assert.deepEqual(locate(anchorOn(lines, 10, 11), lines, 'reanchor'), { startLine: 10, endLine: 11, drifted: false });
});

test('locate: lines shifted by an insertion above are found at the new position', () => {
  const lines = file(20);
  const a = anchorOn(lines, 10, 11);
  const shifted = ['new', 'new2', ...lines];
  assert.deepEqual(locate(a, shifted, 'reanchor'), { startLine: 12, endLine: 13, drifted: false });
});

test('locate: duplicate windows are resolved by matching context first', () => {
  const lines = [...file(5, 'p'), 'dup', ...file(5, 'q'), 'dup', ...file(5, 'r')];
  const a = anchorOn(lines, 12, 12);
  const moved = [...file(8, 'x'), ...lines];
  // the first 'dup' (line 14) is nearer the old line 12, but only the second (line 20) keeps its context
  assert.equal(locate(a, moved, 'reanchor').startLine, 20);
});

test('locate: with equal context, the window nearest the old position wins, then the earliest', () => {
  const lines = ['dup', 'a', 'a', 'a', 'dup', 'b', 'b', 'b', 'dup'];
  const a = { ...anchorOn(lines, 5, 5), ctxBefore: { hash: 'x', n: 0 }, ctxAfter: { hash: 'y', n: 0 } };
  assert.equal(locate(a, lines, 'volatile').startLine, 5);
  const far = { ...a, startLine: 7, endLine: 7 };
  assert.equal(locate(far, lines, 'volatile').startLine, 5);
  const mid = { ...a, startLine: 3, endLine: 3 };
  assert.equal(locate(mid, lines, 'volatile').startLine, 1);
});

test('locate: changed lines with unique surrounding context re-anchor as drifted over the new gap', () => {
  const lines = file(20);
  const a = anchorOn(lines, 10, 11);
  const edited = [...lines.slice(0, 9), 'EDITED-A', 'EDITED-B', 'EDITED-C', ...lines.slice(11)];
  assert.deepEqual(locate(a, edited, 'reanchor'), { startLine: 10, endLine: 12, drifted: true });
});

test('locate: ambiguous context gives null', () => {
  const lines = file(20);
  const a = anchorOn(lines, 10, 11);
  const dupCtx = [...lines.slice(0, 9), 'X', 'Y', ...lines.slice(11), ...lines.slice(6, 9), 'X', ...lines.slice(11, 14)];
  assert.equal(locate(a, dupCtx, 'reanchor'), null);
});

test('locate: a gap wider than 2L+10 is not a drift', () => {
  const lines = file(60);
  const a = anchorOn(lines, 10, 10);
  const edited = [...lines.slice(0, 9), ...Array.from({ length: 30 }, (_, i) => `n${i}`), ...lines.slice(10)];
  assert.equal(locate(a, edited, 'reanchor'), null);
});

test('locate: volatile mode has no context fallback — changed lines return null', () => {
  const lines = file(20);
  const a = anchorOn(lines, 10, 11);
  const edited = [...lines.slice(0, 9), 'EDITED', ...lines.slice(11)];
  assert.equal(locate(a, edited, 'volatile'), null);
  assert.ok(locate(a, edited, 'reanchor'));
});

const text = (oldStart, oldLines, newStart, newLines, id) => ({ id, kind: 'text', oldStart, oldLines, newStart, newLines });

test('hunkFor: the hunk whose span contains endLine owns the anchor', () => {
  const hunks = [text(1, 3, 1, 3, 'h1'), text(20, 3, 20, 3, 'h2')];
  assert.equal(hunkFor({ side: 'new', startLine: 2, endLine: 2 }, hunks), 'h1');
  assert.equal(hunkFor({ side: 'new', startLine: 21, endLine: 22 }, hunks), 'h2');
});

test('hunkFor: a range spanning two hunks belongs to the one holding its last line', () => {
  const hunks = [text(1, 3, 1, 3, 'h1'), text(20, 3, 20, 3, 'h2')];
  assert.equal(hunkFor({ side: 'new', startLine: 2, endLine: 21 }, hunks), 'h2');
});

test('hunkFor: a range ending in context after a hunk falls back to the last hunk it overlaps; pure context gives null', () => {
  const hunks = [text(1, 3, 1, 3, 'h1'), text(20, 3, 20, 3, 'h2')];
  assert.equal(hunkFor({ side: 'new', startLine: 2, endLine: 10 }, hunks), 'h1');
  assert.equal(hunkFor({ side: 'new', startLine: 5, endLine: 8 }, hunks), null);
});

test('hunkFor: spans are per side; a zero count is an empty span', () => {
  const hunks = [text(5, 2, 5, 0, 'del')];
  assert.equal(hunkFor({ side: 'old', startLine: 6, endLine: 6 }, hunks), 'del');
  assert.equal(hunkFor({ side: 'new', startLine: 5, endLine: 5 }, hunks), null);
});

test('hunkFor: a range overlapping two hunks with its end in no hunk belongs to the last one overlapped', () => {
  const hunks = [text(1, 3, 1, 3, 'h1'), text(20, 3, 20, 3, 'h2'), text(40, 3, 40, 3, 'h3')];
  assert.equal(hunkFor({ side: 'new', startLine: 2, endLine: 30 }, hunks), 'h2');
});

test('locate: an exact match clears drifted even if the anchor was drifted before', () => {
  const lines = file(20);
  const a = { ...anchorOn(lines, 10, 11), drifted: true };
  assert.deepEqual(locate(a, lines, 'reanchor'), { startLine: 10, endLine: 11, drifted: false });
});

test('locate: a unique before-context with a duplicated after-context is not enough', () => {
  const base = ['b1', 'b2', 'b3', 'SEL', 'a1', 'a2', 'a3'];
  const a = anchorOn(base, 4, 4);
  const dupAfter = ['b1', 'b2', 'b3', 'EDIT', 'a1', 'a2', 'a3', 'z', 'a1', 'a2', 'a3'];
  assert.equal(locate(a, dupAfter, 'reanchor'), null);
  const dupBefore = ['b1', 'b2', 'b3', 'z', 'b1', 'b2', 'b3', 'EDIT', 'a1', 'a2', 'a3'];
  assert.equal(locate(a, dupBefore, 'reanchor'), null);
});

test('locate: before and after blocks that touch (empty gap) or overlap are not a drift', () => {
  const a = anchorOn(['b1', 'b2', 'b3', 'SEL', 'a1', 'a2', 'a3'], 4, 4);
  assert.equal(locate(a, ['b1', 'b2', 'b3', 'a1', 'a2', 'a3'], 'reanchor'), null, 'selection deleted: empty gap');
  const o = anchorOn(['x', 'y', 'z', 'SEL', 'y', 'z', 'w'], 4, 4);
  assert.equal(locate(o, ['x', 'y', 'z', 'w'], 'reanchor'), null, 'overlapping blocks');
});
