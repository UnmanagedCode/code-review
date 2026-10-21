import { act } from '@testing-library/react';
import { vi } from 'vitest';

/**
 * Stubs `window.matchMedia`: the listed queries match as given (and can be flipped with `set`); any other query
 * falls through to happy-dom's own (1024px-wide window).
 */
export function installMedia(initial: Record<string, boolean>) {
  const state = new Map(Object.entries(initial));
  const listeners = new Map<string, Set<() => void>>();
  const real = window.matchMedia.bind(window);
  vi.stubGlobal('matchMedia', (query: string) => {
    if (!state.has(query)) return real(query);
    const set = listeners.get(query) ?? new Set();
    listeners.set(query, set);
    return {
      media: query,
      matches: state.get(query),
      addEventListener: (_: string, fn: () => void) => set.add(fn),
      removeEventListener: (_: string, fn: () => void) => set.delete(fn),
    };
  });
  return {
    set(query: string, matches: boolean) {
      state.set(query, matches);
      act(() => listeners.get(query)?.forEach((fn) => fn()));
    },
  };
}
