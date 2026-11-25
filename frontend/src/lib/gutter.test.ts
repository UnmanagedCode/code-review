import { expect, test } from 'vitest';
import { diffFile } from '@/test/fixtures';
import { gutterWidth } from './gutter';

const withCount = (n: number) => diffFile({ lineCount: { old: n, new: n } });

// Invariant: a file whose line numbers fit three digits keeps the stock gutter; a wider one gets a width that follows its widest number, so the hover + never covers a digit.
test('up to three digits: no override, wrapped or not', () => {
  for (const n of [1, 99, 999]) {
    expect(gutterWidth(withCount(n), false), String(n)).toBeUndefined();
    expect(gutterWidth(withCount(n), true), String(n)).toBeUndefined();
  }
});
test('four or more digits widen the gutter, and more digits are wider', () => {
  expect(gutterWidth(withCount(1000), false)).toMatch(/^calc\(4ch \+ /);
  expect(gutterWidth(withCount(11005), false)).toMatch(/^calc\(5ch \+ /);
  expect(gutterWidth(withCount(11005), true)).toMatch(/^calc\(5ch \+ /);
  expect(gutterWidth(withCount(11005), true)).not.toBe(gutterWidth(withCount(11005), false));
});
test('the width follows the widest number across both sides and the shown hunks', () => {
  expect(gutterWidth(diffFile({ lineCount: { old: 120, new: 12000 } }), false)).toMatch(/^calc\(5ch/);
  expect(gutterWidth(diffFile({ lineCount: { old: null, new: null } }), false)).toBeUndefined();
});
