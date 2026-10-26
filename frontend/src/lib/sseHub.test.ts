import { beforeEach, expect, test, vi } from 'vitest';
import { FakeEventSource } from '@/test/fakeEventSource';
import { createHub, type FromWorker, type PortLike, type ToWorker } from './sseHub';
import { openSource, RETRY_MS } from './sseSource';

class FakePort implements PortLike {
  sent: FromWorker[] = [];
  onmessage: PortLike['onmessage'] = null;
  postMessage(m: FromWorker) { this.sent.push(m); }
  say(m: ToWorker) { this.onmessage?.({ data: m }); }
}

let sources: FakeEventSource[];
let urls: string[];
const hub = () => createHub((url, on) => openSource(url, (u) => { urls.push(u); const s = new FakeEventSource(); sources.push(s); return s as unknown as EventSource; }, on));
const connect = (h: ReturnType<typeof hub>) => { const p = new FakePort(); h.connect(p); return p; };
const URL_A = 'http://app.test/p/api/events';
beforeEach(() => { sources = []; urls = []; vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); vi.spyOn(console, 'warn').mockImplementation(() => {}); });

// Invariant: any number of tabs share one stream, opened at the first hello on the URL that tab sent (the worker cannot resolve it itself).
test('two ports share one source, opened on the URL from the first hello', () => {
  const h = hub();
  const a = connect(h); const b = connect(h);
  expect(sources).toHaveLength(0);
  a.say({ t: 'hello', url: URL_A });
  b.say({ t: 'hello', url: 'http://other.test/api/events' });
  expect(sources).toHaveLength(1);
  expect(urls).toEqual([URL_A]);
});

// Invariant: an event reaches every connected tab as its raw data, and none that said bye.
test('an event reaches both ports, and not one that left', () => {
  const h = hub();
  const a = connect(h); const b = connect(h);
  a.say({ t: 'hello', url: URL_A }); b.say({ t: 'hello', url: URL_A });
  sources[0].emit({ id: 'r-1', rev: 2 });
  expect(a.sent).toEqual([{ t: 'review', data: JSON.stringify({ id: 'r-1', rev: 2 }) }]);
  expect(b.sent).toEqual(a.sent);
  b.say({ t: 'bye' });
  sources[0].emit({ id: 'r-2' });
  expect(a.sent).toHaveLength(2);
  expect(b.sent).toHaveLength(1);
});

// Invariant: no stream outlives its last tab; a later hello opens a fresh one.
test('the source closes when every port said bye, and a later hello opens a new one', () => {
  const h = hub();
  const a = connect(h); const b = connect(h);
  a.say({ t: 'hello', url: URL_A }); b.say({ t: 'hello', url: URL_A });
  a.say({ t: 'bye' });
  expect(sources[0].closed).toBe(false);
  b.say({ t: 'bye' });
  expect(sources[0].closed).toBe(true);
  const c = connect(h);
  c.say({ t: 'hello', url: URL_A });
  expect(sources).toHaveLength(2);
  expect(sources[1].closed).toBe(false);
});

// Invariant: a repeated hello from one tab (a bfcache restore) neither duplicates its events nor opens a second source.
test('a repeated hello from one port changes nothing', () => {
  const h = hub();
  const a = connect(h);
  a.say({ t: 'hello', url: URL_A }); a.say({ t: 'hello', url: URL_A });
  sources[0].emit({ id: 'r-1' });
  expect(sources).toHaveLength(1);
  expect(a.sent).toHaveLength(1);
});

// Invariant: a reconnect (events may be missed) is told to every tab, including after the CLOSED retry the source owns.
test('a reconnect reaches every port, also after a closed stream is reopened', () => {
  const h = hub();
  const a = connect(h); const b = connect(h);
  a.say({ t: 'hello', url: URL_A }); b.say({ t: 'hello', url: URL_A });
  sources[0].fail(); sources[0].reopen();
  expect(a.sent).toEqual([{ t: 'reconnect' }]);
  expect(b.sent).toEqual([{ t: 'reconnect' }]);
  sources[0].failClosed();
  vi.advanceTimersByTime(RETRY_MS);
  expect(sources).toHaveLength(2);
  sources[1].reopen();
  expect(a.sent.at(-1)).toEqual({ t: 'reconnect' });
  expect(b.sent).toHaveLength(2);
});
