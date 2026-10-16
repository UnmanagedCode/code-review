import { act, renderHook } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { navigate, parseRoute, toSearch, useRoute, type Route } from './route';

test('parse∘serialise round-trips every param', () => {
  const full: Route = { project: 'app', worktree: 'feature', review: 'r-1', file: 'src/a b.ts', side: 'old', lines: '10-20', thread: 't-3', commit: 'abc1234', view: 'threads' };
  expect(parseRoute(toSearch(full))).toEqual(full);
});

test('unknown params and malformed values are dropped', () => {
  expect(parseRoute('?project=app&evil=1&side=sideways&lines=a-b&view=other')).toEqual({ project: 'app' });
});

test('navigate pushes a ?… URL and never assigns the hash', () => {
  const push = vi.spyOn(history, 'pushState');
  navigate({ project: 'app', review: 'r-1' });
  expect(push).toHaveBeenCalledWith(null, '', '?project=app&review=r-1');
  expect(location.hash).toBe('');
  navigate({ review: undefined });
  expect(location.search).toBe('?project=app');
});

test('navigate with replace swaps the entry', () => {
  const push = vi.spyOn(history, 'pushState');
  const replace = vi.spyOn(history, 'replaceState');
  navigate({ project: 'app' }, { replace: true });
  expect(replace).toHaveBeenCalled();
  expect(push).not.toHaveBeenCalled();
});

test('useRoute re-reads on popstate and after navigate', () => {
  const { result } = renderHook(() => useRoute());
  expect(result.current).toEqual({});
  act(() => { history.replaceState(null, '', '?project=x'); window.dispatchEvent(new PopStateEvent('popstate')); });
  expect(result.current).toEqual({ project: 'x' });
  act(() => navigate({ review: 'r-2' }));
  expect(result.current).toEqual({ project: 'x', review: 'r-2' });
});
