import { expect, test } from 'vitest';
import { clampPanel, DIFF_MIN_PX, PANEL_DEFAULT_PX, PANEL_MAX_PX, PANEL_MIN_PX, parseWidth } from './panelWidth';

// Invariant: the panel stays within its min/max.
test('the width is clamped to the panel bounds', () => {
  expect(clampPanel(100, 2000)).toBe(PANEL_MIN_PX);
  expect(clampPanel(5000, 3000)).toBe(PANEL_MAX_PX);
});

// Invariant: the diff keeps at least DIFF_MIN_PX while room allows.
test('the panel leaves the diff its minimum width', () => {
  expect(clampPanel(600, 900)).toBe(900 - DIFF_MIN_PX);
});

// Invariant: with too little room the panel minimum wins, so the panel is never crushed.
test('with too little room for both minimums the panel keeps its own', () => {
  expect(clampPanel(600, 500)).toBe(PANEL_MIN_PX);
});

// Invariant: before measurement only the absolute bounds apply.
test('an unmeasured room clamps to the absolute bounds only', () => {
  expect(clampPanel(9999, null)).toBe(PANEL_MAX_PX);
});

// Invariant: bad stored values fall back to the default width.
test('parseWidth falls back to the default for a missing or non-numeric value', () => {
  for (const raw of [null, 'abc', 'NaN', 'Infinity', '']) expect(parseWidth(raw)).toBe(PANEL_DEFAULT_PX);
  expect(parseWidth('500')).toBe(500);
});
