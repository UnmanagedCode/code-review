import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { FakeEventSource, installFakeEventSource } from '@/test/fakeEventSource';
import { fileState, review } from '@/test/fixtures';
import { stubFetch } from '@/test/stubFetch';
import { REFOCUS_MIN_MS } from './live';
import { useReview } from './review';

const detail = (rev: number, kind: 'range' | 'uncommitted' = 'range') => ({ review: review({ rev, kind }), files: [fileState()], rounds: [], submissions: [], outdatedThreads: [] });

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
