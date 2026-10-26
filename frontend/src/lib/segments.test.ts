import { expect, test } from 'vitest';
import { mergeSegments } from './segments';

test('overlapping syntax and emphasis become non-overlapping segments keeping both', () => {
  // Invariant: the merged segments concatenate to the line and each keeps its token class and emphasis flag.
  const syntax = [{ text: 'const', cls: 'k' }, { text: ' x = ', cls: null }, { text: '"abc"', cls: 's' }];
  const out = mergeSegments(syntax, [{ start: 3, end: 8 }, { start: 11, end: 13 }]);
  expect(out.map((s) => s.text).join('')).toBe('const x = "abc"');
  expect(out.map((s) => [s.text, s.cls, s.em])).toEqual([
    ['con', 'k', false], ['st', 'k', true], [' x ', null, true], ['= ', null, false], ['"', 's', false], ['ab', 's', true], ['c"', 's', false],
  ]);
});

test('no emphasis leaves the syntax segments as they are; an empty line has no segments', () => {
  // Invariant: emphasis-free lines render exactly their syntax segments.
  const syntax = [{ text: 'ab', cls: 'k' }, { text: 'cd', cls: null }];
  expect(mergeSegments(syntax, [])).toEqual([{ text: 'ab', cls: 'k', em: false }, { text: 'cd', cls: null, em: false }]);
  expect(mergeSegments([{ text: '', cls: null }], [])).toEqual([]);
});
