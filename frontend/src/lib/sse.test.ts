import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { FakeEventSource } from '@/test/fakeEventSource';
import { onReconnect, setEventSourceFactory, subscribe } from './sse';
import { RETRY_MAX_MS, RETRY_MS } from './sseSource';

let sources: FakeEventSource[];
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  sources = [];
  setEventSourceFactory(() => { const s = new FakeEventSource(); sources.push(s); return s as unknown as EventSource; });
});
afterEach(() => vi.restoreAllMocks());

// Invariant: the page owns the stream: unsubscribing every handler (a list ↔ review swap) never closes or reopens it.
test('one stream survives every subscriber unmounting and a new one subscribing', () => {
  const off = subscribe(() => {});
  off();
  const got: string[] = [];
  const off2 = subscribe((e) => got.push(e.id));
  sources[0].emit({ id: 'r-1' });
  expect(sources).toHaveLength(1);
  expect(sources[0].closed).toBe(false);
  expect(got).toEqual(['r-1']);
  off2();
});

// Invariant: an event is parsed once and reaches every subscriber; garbage reaches none and does not throw.
test('events reach every subscriber and a malformed one is dropped', () => {
  const a = vi.fn(); const b = vi.fn();
  subscribe(a); subscribe(b);
  sources[0].emit({ id: 'r-1', rev: 2 });
  sources[0].emitRaw('{nope');
  expect(a).toHaveBeenCalledTimes(1);
  expect(b).toHaveBeenCalledWith({ id: 'r-1', rev: 2 });
});

// Invariant: a transient error is the browser's to retry: the next open reports a reconnect, without a new source.
test('a transient error then open reports a reconnect on the same source', () => {
  const re = vi.fn();
  onReconnect(re);
  sources[0].reopen();
  expect(re).not.toHaveBeenCalled();
  sources[0].fail();
  vi.advanceTimersByTime(RETRY_MAX_MS * 2);
  expect(sources).toHaveLength(1);
  sources[0].reopen();
  expect(re).toHaveBeenCalledTimes(1);
});

// Invariant: a CLOSED source (browser gave up) is reopened by us after RETRY_MS, and its first open counts as a reconnect.
test('a closed stream is reopened after RETRY_MS and reports a reconnect', () => {
  const re = vi.fn();
  onReconnect(re);
  sources[0].failClosed();
  vi.advanceTimersByTime(RETRY_MS - 1);
  expect(sources).toHaveLength(1);
  vi.advanceTimersByTime(1);
  expect(sources).toHaveLength(2);
  expect(console.warn).toHaveBeenCalled();
  sources[1].reopen();
  expect(re).toHaveBeenCalledTimes(1);
});

// Invariant: repeated refusals back off (doubling, capped) and a successful open resets the delay.
test('retry delay doubles up to the cap and resets after an open', () => {
  onReconnect(() => {});
  sources[0].failClosed();
  vi.advanceTimersByTime(RETRY_MS);
  sources[1].failClosed();
  vi.advanceTimersByTime(RETRY_MS * 2 - 1);
  expect(sources).toHaveLength(2);
  vi.advanceTimersByTime(1);
  expect(sources).toHaveLength(3);
  sources[2].reopen();
  sources[2].failClosed();
  vi.advanceTimersByTime(RETRY_MS);
  expect(sources).toHaveLength(4);
  let n = sources.length;
  for (let i = 0; i < 8; i++) { sources[n - 1].failClosed(); vi.advanceTimersByTime(RETRY_MAX_MS); expect(sources).toHaveLength(++n); }
});
