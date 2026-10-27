import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { FakeEventSource, installFakeEventSource } from '@/test/fakeEventSource';
import { fileState, review } from '@/test/fixtures';
import { stubFetch } from '@/test/stubFetch';
import { REFOCUS_MIN_MS } from './live';
import { useReview } from './review';

const detail = (rev: number, kind: 'range' | 'uncommitted' = 'range') => ({ review: review({ rev, kind }), files: [fileState()], rounds: [], submissions: [], outdatedThreads: [], reviewThreads: [] });

beforeEach(() => { installFakeEventSource(); });
afterEach(() => { vi.useRealTimers(); });

async function loaded(rev = 5) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  let current = rev;
  const net = stubFetch({ 'GET api/reviews/r-1': () => detail(current) });
  const hook = renderHook(() => useReview('r-1'));
  await vi.waitFor(() => expect(hook.result.current.data?.review.rev).toBe(rev));
  return { hook, net, setRev: (r: number) => { current = r; } };
}

test('an SSE event with rev above knownRev refetches once after the debounce', async () => {
  const { net, setRev } = await loaded();
  setRev(6);
  act(() => { FakeEventSource.last!.emit({ id: 'r-1', rev: 6 }); FakeEventSource.last!.emit({ id: 'r-1', rev: 6 }); });
  expect(net.count('GET api/reviews/r-1')).toBe(1);
  await act(() => vi.advanceTimersByTimeAsync(300));
  expect(net.count('GET api/reviews/r-1')).toBe(2);
});

test('an event with rev ≤ knownRev, or for another review, is ignored', async () => {
  const { net } = await loaded();
  act(() => { FakeEventSource.last!.emit({ id: 'r-1', rev: 5 }); FakeEventSource.last!.emit({ id: 'r-2', rev: 99 }); });
  await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(net.count('GET api/reviews/r-1')).toBe(1);
});

test('applyReview advances knownRev so the SSE echo of our own write does not refetch', async () => {
  const { hook, net } = await loaded();
  act(() => hook.result.current.applyReview(review({ rev: 7 })));
  act(() => FakeEventSource.last!.emit({ id: 'r-1', rev: 7 }));
  await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(net.count('GET api/reviews/r-1')).toBe(1);
  expect(hook.result.current.data?.review.rev).toBe(7);
});

test('{deleted:true} for the open review sets the deleted state', async () => {
  const { hook } = await loaded();
  act(() => FakeEventSource.last!.emit({ id: 'r-1', deleted: true }));
  expect(hook.result.current.deleted).toBe(true);
});

test('an SSE reconnect refetches at once', async () => {
  const { net } = await loaded();
  act(() => { FakeEventSource.last!.fail(); FakeEventSource.last!.reopen(); });
  await vi.waitFor(() => expect(net.count('GET api/reviews/r-1')).toBe(2));
});

test('an uncommitted review refetches on the interval and on window focus; a range review does not', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  const net = stubFetch({ 'GET api/reviews/r-1': () => detail(1, 'uncommitted') });
  const hook = renderHook(() => useReview('r-1'));
  await vi.waitFor(() => expect(hook.result.current.data).toBeDefined());
  await act(() => vi.advanceTimersByTimeAsync(15_000));
  expect(net.count('GET api/reviews/r-1')).toBe(2);
  await act(() => vi.advanceTimersByTimeAsync(REFOCUS_MIN_MS));
  act(() => { window.dispatchEvent(new Event('focus')); });
  await vi.waitFor(() => expect(net.count('GET api/reviews/r-1')).toBe(3));
});

test('a range review is not polled', async () => {
  const { net } = await loaded();
  await act(() => vi.advanceTimersByTimeAsync(60_000));
  expect(net.count('GET api/reviews/r-1')).toBe(1);
});

// Invariant: a review deleted while nobody had it open shows as deleted on the next visit, from the cache and without a fetch,
// instead of rendering the cached pre-delete detail as live.
test('a delete event for a cached review makes a later mount deleted, with no refetch', async () => {
  const { hook, net } = await loaded();
  expect(hook.result.current.deleted).toBe(false);
  hook.unmount();
  act(() => { FakeEventSource.last!.emit({ id: 'r-1', deleted: true }); });
  const renders: { deleted: boolean; data: unknown }[] = [];
  renderHook(() => { const r = useReview('r-1'); renders.push({ deleted: r.deleted, data: r.data }); return r; });
  expect(renders[0]).toEqual({ deleted: true, data: undefined });
  await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(net.count('GET api/reviews/r-1')).toBe(1);
});

// Invariant: a delete while the review is open still shows the deleted state at once.
test('a delete event while mounted marks the review deleted', async () => {
  const { hook } = await loaded();
  act(() => { FakeEventSource.last!.emit({ id: 'r-1', deleted: true }); });
  expect(hook.result.current.deleted).toBe(true);
});

// Invariant: one transition costs one request: a stale uncommitted review whose tab shows again is fetched by the cache's
// visibility flush, and the poll's focus/visibility kick joins that fetch instead of starting a second.
test('an uncommitted review whose tab shows again after an event is fetched once', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  let state: DocumentVisibilityState = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  try {
    const net = stubFetch({ 'GET api/reviews/r-1': () => detail(5, 'uncommitted') });
    renderHook(() => useReview('r-1'));
    await vi.waitFor(() => expect(net.count('GET api/reviews/r-1')).toBe(1));
    await act(() => vi.advanceTimersByTimeAsync(0));
    act(() => { state = 'hidden'; document.dispatchEvent(new Event('visibilitychange')); });
    act(() => { FakeEventSource.last!.emit({ id: 'r-1', rev: 6 }); });
    await act(() => vi.advanceTimersByTimeAsync(REFOCUS_MIN_MS * 2));
    expect(net.count('GET api/reviews/r-1')).toBe(1);
    await act(async () => { state = 'visible'; document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')); });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(net.count('GET api/reviews/r-1')).toBe(2);
  } finally {
    Reflect.deleteProperty(document, 'visibilityState');
  }
});

// Invariant: revisiting an uncommitted review older than the poll interval costs one request: the mount's revalidation and
// the overdue poll kick are the same fetch.
test('revisiting an old uncommitted review fetches once', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  const net = stubFetch({ 'GET api/reviews/r-1': () => detail(5, 'uncommitted') });
  renderHook(() => useReview('r-1')).unmount();
  await vi.waitFor(() => expect(net.count('GET api/reviews/r-1')).toBe(1));
  await act(() => vi.advanceTimersByTimeAsync(60_000));
  renderHook(() => useReview('r-1'));
  await act(() => vi.advanceTimersByTimeAsync(100));
  expect(net.count('GET api/reviews/r-1')).toBe(2);
});
