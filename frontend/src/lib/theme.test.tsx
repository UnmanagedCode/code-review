import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { useTheme } from './theme';

afterEach(() => document.documentElement.classList.remove('dark'));

test('useTheme follows a .dark flip on <html>', async () => {
  const { result } = renderHook(() => useTheme());
  expect(result.current).toBe('light');
  await act(async () => {
    document.documentElement.classList.add('dark');
    await Promise.resolve();
  });
  expect(result.current).toBe('dark');
  await act(async () => {
    document.documentElement.classList.remove('dark');
    await Promise.resolve();
  });
  expect(result.current).toBe('light');
});
