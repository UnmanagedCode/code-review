import { act, renderHook } from '@testing-library/react';
import { expect, test } from 'vitest';
import { GIT_CONTEXT_LINES } from '@/lib/gitContext';
import { resetDiffPrefs, useDiffPrefs } from './diffPrefs';

test('defaults are git\'s context and whitespace shown', () => {
  // Invariant: with nothing stored the diff looks exactly as git sends it.
  const { result } = renderHook(() => useDiffPrefs());
  expect(result.current.context).toBe(GIT_CONTEXT_LINES);
  expect(result.current.ignoreWhitespace).toBe(false);
});

test('settings persist under code-review:diffContext and code-review:ignoreWhitespace and are read back', () => {
  // Invariant: the options are remembered in this browser, under prefixed keys.
  const { result } = renderHook(() => useDiffPrefs());
  act(() => result.current.setPrefs({ context: 10, ignoreWhitespace: true }));
  expect(result.current).toMatchObject({ context: 10, ignoreWhitespace: true });
  expect(localStorage.getItem('code-review:diffContext')).toBe('10');
  expect(localStorage.getItem('code-review:ignoreWhitespace')).toBe('1');
  resetDiffPrefs();
  const again = renderHook(() => useDiffPrefs());
  expect(again.result.current).toMatchObject({ context: 10, ignoreWhitespace: true });
});

test('an invalid stored value falls back to the default', () => {
  // Invariant: a stale or hand-edited value never yields a context outside the choices.
  for (const bad of ['7', 'abc', '', '-1']) {
    localStorage.setItem('code-review:diffContext', bad);
    resetDiffPrefs();
    expect(renderHook(() => useDiffPrefs()).result.current.context).toBe(GIT_CONTEXT_LINES);
  }
});
