import { act, render, renderHook } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { dispatchShortcut, useRegisteredShortcuts, useShortcutHandler } from './shortcutRegistry';

const key = () => new KeyboardEvent('keydown', { key: 'v', cancelable: true });

// Invariant: a shortcut nobody registered does nothing, leaves the browser's default alone, and is not listed as registered.
test("an unregistered shortcut is a no-op, doesn't preventDefault, and is absent from the registered set", () => {
  const registered = renderHook(() => useRegisteredShortcuts());
  const e = key();
  expect(dispatchShortcut('toggle-viewed', e)).toBe(false);
  expect(e.defaultPrevented).toBe(false);
  expect(registered.result.current.has('toggle-viewed')).toBe(false);
});

// Invariant: a registered handler runs with the key, prevents the default, and a handler that returns false counts as not acting.
test('a handler that acts prevents the default; returning false leaves it', () => {
  const act1 = vi.fn(() => true);
  const idle = vi.fn(() => false);
  const a = renderHook(() => useShortcutHandler('toggle-viewed', act1));
  const e = key();
  expect(dispatchShortcut('toggle-viewed', e)).toBe(true);
  expect(act1).toHaveBeenCalledWith(e);
  expect(e.defaultPrevented).toBe(true);
  a.unmount();
  renderHook(() => useShortcutHandler('toggle-viewed', idle));
  const e2 = key();
  expect(dispatchShortcut('toggle-viewed', e2)).toBe(false);
  expect(e2.defaultPrevented).toBe(false);
});

// Invariant: the handler that runs is the latest render's closure, and registered ids follow mount and unmount (the overlay lists them).
test('unmount unregisters; a re-render swaps the closure without re-registering', () => {
  const registered = renderHook(() => useRegisteredShortcuts());
  const first = vi.fn(), second = vi.fn();
  function Probe({ h }: { h: (() => void) | null }) { useShortcutHandler('focus-file-filter', h); return null; }
  const view = render(<Probe h={first} />);
  expect(registered.result.current.has('focus-file-filter')).toBe(true);
  view.rerender(<Probe h={second} />);
  act(() => { dispatchShortcut('focus-file-filter', key()); });
  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledOnce();
  view.rerender(<Probe h={null} />);
  expect(registered.result.current.has('focus-file-filter')).toBe(false);
  view.rerender(<Probe h={second} />);
  view.unmount();
  expect(registered.result.current.has('focus-file-filter')).toBe(false);
});
