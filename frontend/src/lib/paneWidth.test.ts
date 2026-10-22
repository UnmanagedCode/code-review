import { expect, test } from 'vitest';
import { clampPane, DIFF_MIN_PX, PANE_DEFAULT_PX, PANE_MAX_PX, PANE_MIN_PX, parseWidth } from './paneWidth';

// Invariant: the pane stays within its min/max.
test('the width is clamped to the pane bounds', () => {
  expect(clampPane(100, 2000)).toBe(PANE_MIN_PX);
  expect(clampPane(5000, 3000)).toBe(PANE_MAX_PX);
});

// Invariant: the diff keeps at least DIFF_MIN_PX while room allows.
test('the pane leaves the diff its minimum width', () => {
  expect(clampPane(600, 900)).toBe(900 - DIFF_MIN_PX);
});

// Invariant: with too little room for both minimums the pane minimum wins, so the pane is never crushed.
test('with too little room for both minimums the pane keeps its own', () => {
  expect(clampPane(600, 500)).toBe(PANE_MIN_PX);
});

// Invariant: before measurement only the absolute bounds apply.
test('an unmeasured room clamps to the absolute bounds only', () => {
  expect(clampPane(9999, null)).toBe(PANE_MAX_PX);
});

// Invariant: bad stored values fall back to the default width.
test('parseWidth falls back to the default for a missing or non-numeric value', () => {
  for (const raw of [null, 'abc', 'NaN', 'Infinity', '']) expect(parseWidth(raw)).toBe(PANE_DEFAULT_PX);
  expect(parseWidth('500')).toBe(500);
});
