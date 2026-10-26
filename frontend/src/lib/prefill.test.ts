import { expect, test } from 'vitest';
import { parsePrefill } from './prefill';

// Invariant: `..` and `...` name the same review; each side is kept verbatim for the server to validate.
test('a range splits into base and head at either separator', () => {
  expect(parsePrefill({ range: 'main...HEAD' })).toEqual({ kind: 'range', base: 'main', head: 'HEAD' });
  expect(parsePrefill({ range: 'main..HEAD' })).toEqual({ kind: 'range', base: 'main', head: 'HEAD' });
  expect(parsePrefill({ range: 'feat/x@{1}...abc1234' })).toEqual({ kind: 'range', base: 'feat/x@{1}', head: 'abc1234' });
});

// Invariant: `...` is looked for before `..`, so `a...b` is never read as base `a`, head `.b`.
test('the split is at the first ..., else the first ..', () => {
  expect(parsePrefill({ range: 'a..b...c' })).toEqual({ kind: 'range', base: 'a..b', head: 'c' });
  expect(parsePrefill({ range: 'a..b..c' })).toEqual({ kind: 'range', base: 'a', head: 'b..c' });
});

test('a sha prefills one commit; neither key is no prefill', () => {
  expect(parsePrefill({ sha: 'abc1234' })).toEqual({ kind: 'commit', sha: 'abc1234' });
  expect(parsePrefill({})).toBeNull();
});

// Invariant: a malformed link is an explained error, never a throw and never a half-applied prefill.
test('both keys, no separator or an empty side is an error', () => {
  for (const route of [{ range: 'a...b', sha: 'c' }, { range: 'main' }, { range: '...HEAD' }, { range: 'main..' }, { range: '..' }, { range: '.' }]) {
    const p = parsePrefill(route);
    expect(p && 'error' in p && typeof p.error, JSON.stringify(route)).toBe('string');
  }
});
