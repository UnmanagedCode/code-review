import { act, renderHook } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { navigate, parseRoute, REVIEW_SCOPED, toSearch, useRoute, type Route } from './route';

test('parse∘serialise round-trips every param', () => {
  const full: Route = { project: 'app', worktree: 'feature', review: 'r-1', file: 'src/a b.ts', side: 'old', lines: '10-20', thread: 't-3', commit: 'abc1234', round: '12', view: 'threads' };
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

test('round keeps a positive integer only', () => {
  expect(parseRoute('?round=3').round).toBe('3');
  for (const bad of ['0', '-1', 'x', '01', '1.5']) expect(parseRoute(`?round=${bad}`).round, bad).toBeUndefined();
});

test('REVIEW_SCOPED resets every key but the checkout and the review itself', () => {
  history.replaceState(null, '', toSearch({ project: 'app', worktree: 'feature', review: 'r-1', file: 'a.js', side: 'old', lines: '3', thread: 't-1', commit: 'abc1234', round: '1', view: 'threads' }));
  navigate({ review: 'r-2', ...REVIEW_SCOPED });
  expect(parseRoute(location.search)).toEqual({ project: 'app', worktree: 'feature', review: 'r-2' });
});
