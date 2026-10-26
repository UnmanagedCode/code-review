import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { FakeEventSource } from '@/test/fakeEventSource';
import { onReconnect, resetSse, setEventSourceFactory, setTransportFactory, subscribe } from './sse';
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

class FakeSharedWorker {
  static last: FakeSharedWorker | null = null;
  posted: unknown[] = [];
  portClosed = false;
  private errors: (() => void)[] = [];
  port = {
    onmessage: null as ((e: { data: unknown }) => void) | null,
    start: () => {},
    postMessage: (m: unknown) => { this.posted.push(m); },
    close: () => { this.portClosed = true; },
  };
  constructor(readonly url: URL, readonly options: WorkerOptions) { FakeSharedWorker.last = this; }
  addEventListener(type: string, fn: () => void) { if (type === 'error') this.errors.push(fn); }
  say(data: unknown) { this.port.onmessage?.({ data }); }
  fail() { this.errors.forEach((f) => f()); }
}

// Invariant: with a SharedWorker the tab opens no stream of its own: it joins the worker with its own absolute URL and
// takes events and reconnects from it.
test('with a SharedWorker the stream comes from the worker', () => {
  vi.stubGlobal('SharedWorker', FakeSharedWorker);
  const got: string[] = []; const re = vi.fn();
  subscribe((e) => got.push(e.id));
  onReconnect(re);
  const w = FakeSharedWorker.last!;
  expect(sources).toHaveLength(0);
  expect(w.options).toMatchObject({ type: 'module', name: 'code-review-events' });
  expect(w.posted).toEqual([{ t: 'hello', url: new URL('api/events', document.baseURI).href }]);
  w.say({ t: 'review', data: JSON.stringify({ id: 'r-9' }) });
  w.say({ t: 'reconnect' });
  expect(got).toEqual(['r-9']);
  expect(re).toHaveBeenCalledTimes(1);
});

// Invariant: a worker that fails before relaying anything (CSP, load error) falls back to this tab's own stream, loudly.
test('a worker error before its first message falls back to a stream in this tab', () => {
  vi.stubGlobal('SharedWorker', FakeSharedWorker);
  const got: string[] = [];
  subscribe((e) => got.push(e.id));
  FakeSharedWorker.last!.fail();
  expect(console.warn).toHaveBeenCalled();
  expect(FakeSharedWorker.last!.portClosed).toBe(true);
  expect(sources).toHaveLength(1);
  sources[0].emit({ id: 'r-1' });
  expect(got).toEqual(['r-1']);
});

// Invariant: once the worker has relayed, a later error does not open a second stream.
test('a worker error after it relayed keeps the worker', () => {
  vi.stubGlobal('SharedWorker', FakeSharedWorker);
  subscribe(() => {});
  FakeSharedWorker.last!.say({ t: 'review', data: '{"id":"r-1"}' });
  FakeSharedWorker.last!.fail();
  expect(sources).toHaveLength(0);
});

// Invariant: leaving the page tells the worker (so the last tab out closes the shared stream); a bfcache restore rejoins.
test('pagehide says bye and a persisted pageshow says hello again', () => {
  vi.stubGlobal('SharedWorker', FakeSharedWorker);
  subscribe(() => {});
  const w = FakeSharedWorker.last!;
  window.dispatchEvent(new Event('pagehide'));
  expect(w.posted.at(-1)).toEqual({ t: 'bye' });
  window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
  expect(w.posted.at(-1)).toMatchObject({ t: 'hello' });
});

// Invariant: the transport is a seam: a factory set by a test replaces the choice, and gets the handlers.
test('setTransportFactory replaces the transport', () => {
  let handlers: Parameters<Parameters<typeof setTransportFactory>[0]>[0] | undefined;
  setTransportFactory((on) => { handlers = on; return { close: () => {} }; });
  const got: string[] = [];
  subscribe((e) => got.push(e.id));
  handlers!.review('{"id":"x"}');
  expect(got).toEqual(['x']);
  expect(sources).toHaveLength(0);
});

// Invariant: a page restored from the back/forward cache missed events, so a persisted pageshow is a reconnect for that tab
// (list/inbox have no polling to catch up); a pageshow that is not a restore is not.
test('a persisted pageshow reports a reconnect, in the tab and through the worker', () => {
  const persisted = () => window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
  const re = vi.fn();
  onReconnect(re);
  window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: false }));
  expect(re).not.toHaveBeenCalled();
  persisted();
  expect(re).toHaveBeenCalledTimes(1);
  resetSse();

  vi.stubGlobal('SharedWorker', FakeSharedWorker);
  const re2 = vi.fn();
  onReconnect(re2);
  persisted();
  expect(re2).toHaveBeenCalledTimes(1);
  expect(FakeSharedWorker.last!.posted.at(-1)).toMatchObject({ t: 'hello' });
});

// Invariant: a SharedWorker that cannot be constructed (blocked, CSP) leaves the page with its own stream, with a warning.
test('a SharedWorker constructor that throws falls back to a stream in this tab', () => {
  vi.stubGlobal('SharedWorker', class { constructor() { throw new Error('blocked'); } });
  const got: string[] = [];
  subscribe((e) => got.push(e.id));
  expect(console.warn).toHaveBeenCalled();
  expect(sources).toHaveLength(1);
  sources[0].emit({ id: 'r-1' });
  expect(got).toEqual(['r-1']);
});
