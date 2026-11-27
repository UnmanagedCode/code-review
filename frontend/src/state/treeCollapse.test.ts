import { afterEach, expect, test, vi } from 'vitest';
import { resetTreeCollapse, revealPath, setFolderCollapsed, useCollapsedFolders } from './treeCollapse';
import { renderHook, act } from '@testing-library/react';

afterEach(resetTreeCollapse);

// Invariant: reveal touches only true ancestors (path-segment prefixes, not string prefixes) and is a no-op when already expanded.
test('revealPath expands the ancestors of a file only, and notifies nobody when nothing was collapsed', () => {
  const { result } = renderHook(() => useCollapsedFolders('r'));
  act(() => { ['a', 'a/b', 'a/bc', 'x'].forEach((d) => setFolderCollapsed('r', d, true)); });
  act(() => revealPath('r', 'a/b/c.ts'));
  expect([...result.current].sort()).toEqual(['a/bc', 'x']);
  const before = result.current;
  act(() => revealPath('r', 'a/b/c.ts'));
  expect(result.current).toBe(before);
  // Already expanded: another folder is collapsed for this review, but the revealed path's ancestors never were.
  const spy = vi.fn();
  const { result: other } = renderHook(() => { spy(); return useCollapsedFolders('other'); });
  act(() => setFolderCollapsed('other', 'unrelated', true));
  const held = other.current;
  const renders = spy.mock.calls.length;
  act(() => revealPath('other', 'a/b.ts'));
  expect(other.current).toBe(held);
  expect(spy.mock.calls.length).toBe(renders);
});
