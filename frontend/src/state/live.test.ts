import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { POLL_MS, REFOCUS_MIN_MS, usePolling } from './live';

let visibility: DocumentVisibilityState;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
});
afterEach(() => { Reflect.deleteProperty(document, 'visibilityState'); });

const focus = () => act(() => { window.dispatchEvent(new Event('focus')); });
const show = (v: DocumentVisibilityState) => act(() => { visibility = v; document.dispatchEvent(new Event('visibilitychange')); });
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const setup = () => {
  const reload = vi.fn();
  const hook = renderHook(({ loadedAt }) => usePolling(reload, true, loadedAt), { initialProps: { loadedAt: Date.now() } });
  return { reload, hook };
};

// Invariant: returning to a tab fires focus and visibilitychange; together they cost one request.
test('focus and visibilitychange together reload once', async () => {
  const { reload } = setup();
  await advance(REFOCUS_MIN_MS);
  focus();
  show('visible');
  expect(reload).toHaveBeenCalledTimes(1);
});

// Invariant: clicking into the iframe fires focus each time; at most one reload per REFOCUS_MIN_MS.
test('a second focus within REFOCUS_MIN_MS does nothing, one after it reloads', async () => {
  const { reload } = setup();
  await advance(REFOCUS_MIN_MS);
  focus();
  await advance(REFOCUS_MIN_MS - 1);
  focus();
  expect(reload).toHaveBeenCalledTimes(1);
  await advance(1);
  focus();
  expect(reload).toHaveBeenCalledTimes(2);
});

// Invariant: no polling while hidden; becoming visible after a long hide reloads once.
test('a hidden page makes no reloads, and one when it shows again', async () => {
  const { reload } = setup();
  show('hidden');
  await advance(POLL_MS * 4);
  expect(reload).not.toHaveBeenCalled();
  show('visible');
  expect(reload).toHaveBeenCalledTimes(1);
});

// Invariant: the interval counts from the last load, so a load caused by an event pushes the next poll back.
test('a load pushes the next poll back', async () => {
  const { reload, hook } = setup();
  await advance(POLL_MS - 1000);
  hook.rerender({ loadedAt: Date.now() });
  await advance(POLL_MS - 1);
  expect(reload).not.toHaveBeenCalled();
  await advance(1);
  expect(reload).toHaveBeenCalledTimes(1);
});

// Invariant: a page that is not polled (a range review) never reloads on its own.
test('disabled polling ignores focus and the interval', async () => {
  const reload = vi.fn();
  renderHook(() => usePolling(reload, false, 0));
  await advance(POLL_MS * 2);
  focus();
  expect(reload).not.toHaveBeenCalled();
});
