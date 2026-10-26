import { expect, test } from 'vitest';
import { WORD_DIFF_MAX_CHARS, WORD_DIFF_MAX_TOKENS, wordDiff } from './wordDiff';

test('only the changed token is emphasised on each side', () => {
  // Invariant: emphasis covers exactly the tokens outside the common subsequence.
  expect(wordDiff('foo(bar)', 'foo(baz)')).toEqual({ a: [{ start: 4, end: 7 }], b: [{ start: 4, end: 7 }] });
  expect(wordDiff('let x = 1;', 'let x = 1; // two')).toEqual({ a: [], b: [{ start: 10, end: 17 }] });
});

test('identical lines have no emphasis', () => {
  // Invariant: no change, no emphasis.
  expect(wordDiff('same line', 'same line')).toEqual({ a: [], b: [] });
});

test('past the character or token caps there is no word diff', () => {
  // Invariant: the quadratic token LCS is bounded by WORD_DIFF_MAX_CHARS / WORD_DIFF_MAX_TOKENS.
  expect(wordDiff('a'.repeat(WORD_DIFF_MAX_CHARS + 1), 'b')).toBeNull();
  expect(wordDiff('b', 'a'.repeat(WORD_DIFF_MAX_CHARS + 1))).toBeNull();
  const many = Array.from({ length: Math.ceil((WORD_DIFF_MAX_TOKENS + 1) / 2) }, () => 'x').join(' ');
  expect(many.length).toBeLessThanOrEqual(WORD_DIFF_MAX_CHARS);
  expect(wordDiff(many, 'x')).toBeNull();
  expect(wordDiff('a'.repeat(WORD_DIFF_MAX_CHARS), 'b')).not.toBeNull();
});

test('ignoreWhitespace: a whitespace-only difference yields no ranges, and a real change keeps only its non-blank range', () => {
  // Invariant: under Ignore whitespace, emphasis never marks whitespace alone.
  expect(wordDiff('foo(a,b)', 'foo(a,  b)', { ignoreWhitespace: true })).toEqual({ a: [], b: [] });
  expect(wordDiff('\tif (x) {', '    if (x) {', { ignoreWhitespace: true })).toEqual({ a: [], b: [] });
  expect(wordDiff('  a = 1', '    a = 2', { ignoreWhitespace: true })).toEqual({ a: [{ start: 6, end: 7 }], b: [{ start: 8, end: 9 }] });
  expect(wordDiff('foo(a,b)', 'foo(a, b)')?.b).toEqual([{ start: 6, end: 7 }]);
});
