import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { FakeEventSource, installFakeEventSource } from '@/test/fakeEventSource';
import { DEBOUNCE_MS, ensure, MAX_AGE_MS, mutateResource, useResource, type Resource, type Spec } from './resource';

let visibility: DocumentVisibilityState;
const setVisibility = (v: DocumentVisibilityState) => {
  visibility = v;
  document.dispatchEvent(new Event('visibilitychange'));
};
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  installFakeEventSource();
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
});
afterEach(() => { Reflect.deleteProperty(document, 'visibilityState'); });

const counter = (over: Partial<Spec<{ n: number }>> = {}) => {
  let n = 0;
  const fetch = vi.fn(async () => ({ n: ++n }));
  return { fetch, spec: { fetch, ...over } satisfies Spec<{ n: number }> };
};
const settle = (ms = 0) => act(() => vi.advanceTimersByTimeAsync(ms));
const emit = (e: object) => act(() => { FakeEventSource.last!.emit(e); });
const matchAll = () => true;
/** Mounts one hook and keeps the value of its first render. */
function mount<T>(key: string, spec: Spec<T>) {
  const renders: Resource<T>[] = [];
  const hook = renderHook(() => { const r = useResource(key, spec); renders.push(r); return r; });
  return { ...hook, first: renders[0] };
}

// Invariant: hooks on one key share one entry and one in-flight fetch (the double projects/sessions fetches).
test('two hooks on one key share one fetch and one result', async () => {
  const { fetch, spec } = counter();
  const { result } = renderHook(() => [useResource('k', spec), useResource('k', spec)] as const);
  await settle();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(result.current[0].data).toEqual({ n: 1 });
  expect(result.current[1].data).toEqual({ n: 1 });
});

// Invariant: a revisit renders cached data on the first render; it revalidates in the background only once older than MAX_AGE_MS.
test('a remount within MAX_AGE_MS fetches nothing; after it, one background fetch with the old data still shown', async () => {
  const { fetch, spec } = counter();
  renderHook(() => useResource('k', spec)).unmount();
  await settle();
  const first = mount('k', spec);
  expect(first.first).toMatchObject({ data: { n: 1 } });
  await settle(MAX_AGE_MS - 1);
  expect(fetch).toHaveBeenCalledTimes(1);
  first.unmount();
  await settle(2);
  const again = mount('k', spec);
  expect(again.first).toMatchObject({ data: { n: 1 } });
  await settle();
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(again.result.current.data).toEqual({ n: 2 });
});

// Invariant: only events the spec matches refetch, once, after DEBOUNCE_MS however many arrive.
test('a matching event refetches once after DEBOUNCE_MS; a non-matching one does nothing', async () => {
  const { fetch, spec } = counter({ matches: (e) => e.id === 'r-1' });
  renderHook(() => useResource('k', spec));
  await settle();
  await emit({ id: 'r-2' });
  await settle(DEBOUNCE_MS * 2);
  expect(fetch).toHaveBeenCalledTimes(1);
  await emit({ id: 'r-1' });
  await emit({ id: 'r-1' });
  await settle(DEBOUNCE_MS - 1);
  expect(fetch).toHaveBeenCalledTimes(1);
  await settle(1);
  expect(fetch).toHaveBeenCalledTimes(2);
});

// Invariant: a hidden tab fetches nothing for events; it catches up when shown.
test('an event while hidden fetches nothing until the tab is visible', async () => {
  const { fetch, spec } = counter({ matches: matchAll });
  renderHook(() => useResource('k', spec));
  await settle();
  act(() => setVisibility('hidden'));
  await emit({ id: 'r-1' });
  await settle(DEBOUNCE_MS * 5);
  expect(fetch).toHaveBeenCalledTimes(1);
  act(() => setVisibility('visible'));
  await settle();
  expect(fetch).toHaveBeenCalledTimes(2);
});

// Invariant: a change announced while a fetch is in flight is never lost: the fetch may predate it, so it runs again.
test('an event during an in-flight fetch triggers a second fetch', async () => {
  const gates: (() => void)[] = [];
  const fetch = vi.fn(() => new Promise<number>((res) => { gates.push(() => res(gates.length)); }));
  renderHook(() => useResource('k', { fetch, matches: matchAll }));
  await settle();
  await emit({ id: 'r-1' });
  await settle(DEBOUNCE_MS);
  expect(fetch).toHaveBeenCalledTimes(1);
  await act(async () => { gates[0](); });
  await settle();
  expect(fetch).toHaveBeenCalledTimes(2);
});

// Invariant: after the stream reconnects (events may be missed) every mounted, visible entry that listens refetches at once.
test('a reconnect refetches mounted entries that listen to events, and only those', async () => {
  const listening = counter({ matches: () => false });
  const plain = counter();
  renderHook(() => [useResource('k', listening.spec), useResource('plain', plain.spec)]);
  await settle();
  act(() => { FakeEventSource.last!.fail(); FakeEventSource.last!.reopen(); });
  await settle();
  expect(listening.fetch).toHaveBeenCalledTimes(2);
  expect(plain.fetch).toHaveBeenCalledTimes(1);
});

// Invariant: an entry invalidated while nobody shows it is revalidated when next mounted, not served stale.
test('an event for an unmounted entry marks it stale for the next mount', async () => {
  const { fetch, spec } = counter({ matches: matchAll });
  renderHook(() => useResource('k', spec)).unmount();
  await settle();
  const other = renderHook(() => useResource('other', counter({ matches: matchAll }).spec)); // keeps the stream open
  await emit({ id: 'r-1' });
  await settle(DEBOUNCE_MS);
  expect(fetch).toHaveBeenCalledTimes(1);
  other.unmount();
  const again = mount('k', spec);
  expect(again.first).toMatchObject({ data: { n: 1 } });
  await settle();
  expect(fetch).toHaveBeenCalledTimes(2);
});

// Invariant: the idle cache is bounded and evicts the least recently used entry first.
test('idle entries beyond the cap are evicted, oldest first', async () => {
  const { fetch, spec } = counter();
  for (let i = 0; i < 33; i++) {
    const h = renderHook(() => useResource(`k${i}`, spec));
    await settle();
    h.unmount();
  }
  expect(fetch).toHaveBeenCalledTimes(33);
  renderHook(() => useResource('k32', spec));
  await settle();
  expect(fetch).toHaveBeenCalledTimes(33);
  renderHook(() => useResource('k0', spec));
  await settle();
  expect(fetch).toHaveBeenCalledTimes(34);
});

// Invariant: with keepPrevious a new key shows the last data (flagged placeholder, loading) until its own data arrives.
test('keepPrevious shows the previous key\'s data as a placeholder while the next loads', async () => {
  let release!: () => void;
  const fetch = vi.fn((k: string) => (k === 'a' ? Promise.resolve('A') : new Promise<string>((res) => { release = () => res('B'); })));
  const { result, rerender } = renderHook(({ k }) => useResource(k, { fetch: () => fetch(k) }, { keepPrevious: true }), { initialProps: { k: 'a' } });
  await settle();
  expect(result.current).toMatchObject({ data: 'A', placeholder: false });
  rerender({ k: 'b' });
  expect(result.current).toMatchObject({ data: 'A', placeholder: true, loading: true });
  await settle();
  expect(result.current).toMatchObject({ data: 'A', placeholder: true });
  await act(async () => { release(); });
  await settle();
  expect(result.current).toMatchObject({ data: 'B', placeholder: false, loading: false });
});

// Invariant: a local patch reaches every mount of the key, and leaves the load counter alone.
test('mutate and mutateResource update every mount without counting as a load', async () => {
  const { spec } = counter();
  const { result } = renderHook(() => [useResource('k', spec), useResource('k', spec)] as const);
  await settle();
  act(() => result.current[0].mutate((d) => ({ n: d.n + 10 })));
  expect(result.current[1].data).toEqual({ n: 11 });
  act(() => mutateResource<{ n: number }>('k', (d) => ({ n: d.n + 1 })));
  expect(result.current[0].data).toEqual({ n: 12 });
  expect(result.current[0].version).toBe(1);
});

// Invariant: `version` counts this key's successful loads across mounts, not per mount.
test('version keeps counting across a remount', async () => {
  const { spec } = counter();
  const h = renderHook(() => useResource('k', spec));
  await settle();
  act(() => h.result.current.reload());
  await settle();
  expect(h.result.current.version).toBe(2);
  h.unmount();
  expect(mount('k', spec).first).toMatchObject({ version: 2 });
});

// Invariant: ensure reads the shared entry: cached data the caller accepts costs no fetch; data it rejects is refetched.
test('ensure serves accepted cached data and refetches rejected data', async () => {
  const { fetch, spec } = counter();
  expect(await ensure('k', spec)).toEqual({ n: 1 });
  expect(await ensure('k', spec, (d) => d.n === 1)).toEqual({ n: 1 });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(await ensure('k', spec, (d) => d.n === 2)).toEqual({ n: 2 });
  expect(fetch).toHaveBeenCalledTimes(2);
});

// Invariant: a failed reload keeps the data on screen and reports the error; a failed first load has data undefined.
test('a failed refetch keeps the previous data', async () => {
  let fail = false;
  const spec = { fetch: vi.fn(async () => { if (fail) throw new Error('boom'); return 'ok'; }) };
  const h = renderHook(() => useResource('k', spec));
  await settle();
  fail = true;
  act(() => h.result.current.reload());
  await settle();
  expect(h.result.current).toMatchObject({ data: 'ok', loading: false });
  expect((h.result.current.error as Error).message).toBe('boom');
});

// Invariant: an entry flagged gone by a delete drops its data, reports `gone` on every later mount and is never fetched again.
test('a gone event leaves the entry gone for a later mount, without a fetch', async () => {
  const { fetch, spec } = counter({ gone: (e) => !!e.deleted });
  renderHook(() => useResource('k', spec)).unmount();
  await settle();
  await emit({ id: 'r-1', deleted: true });
  const again = mount('k', spec);
  expect(again.first).toMatchObject({ gone: true, data: undefined, loading: false });
  await settle(MAX_AGE_MS * 2);
  expect(fetch).toHaveBeenCalledTimes(1);
});

// Invariant: `version` keeps rising across an eviction, so a consumer holding an older version sees a recreated entry as newer.
test('an evicted entry comes back with its load count, not from zero', async () => {
  const { spec } = counter();
  const first = renderHook(() => useResource('k0', spec));
  await settle();
  first.unmount();
  for (let i = 1; i <= 32; i++) { const h = renderHook(() => useResource(`k${i}`, spec)); await settle(); h.unmount(); }
  const again = mount('k0', spec);
  expect(again.first.version).toBe(1);
  expect(again.first.data).toBeUndefined();
  await settle();
  expect(again.result.current.version).toBe(2);
});

// Invariant: the tag is read when a fetch starts and kept with the data that fetch returns, not read at completion.
test('dataTag is the tag the fetch started under, even if the tag changes while it runs', async () => {
  let tag = 'a';
  const gates: (() => void)[] = [];
  const fetch = vi.fn(() => new Promise<number>((res) => { gates.push(() => res(gates.length)); }));
  const h = renderHook(() => useResource('k', { fetch, tag: () => tag }));
  await settle();
  tag = 'b'; // flipped while the first fetch is in flight
  await act(async () => { gates[0](); });
  await settle();
  expect(h.result.current).toMatchObject({ data: 1, dataTag: 'a' });
  act(() => h.result.current.reload());
  await settle();
  tag = 'c';
  await act(async () => { gates[1](); });
  await settle();
  expect(h.result.current).toMatchObject({ data: 2, dataTag: 'b' });
});

// Invariant: a join reload (poll or focus kick) shares a fetch the visibility flush just started: one transition, one request.
test('a join reload during a fetch started after the last invalidation starts no second one', async () => {
  const { fetch, spec } = counter({ matches: matchAll });
  const h = renderHook(() => useResource('k', spec));
  await settle();
  act(() => setVisibility('hidden'));
  await emit({ id: 'r-1' });
  act(() => { setVisibility('visible'); h.result.current.reload({ join: true }); });
  await settle(DEBOUNCE_MS * 3);
  expect(fetch).toHaveBeenCalledTimes(2);
});

// Invariant: joining never hides a change announced after the running fetch started: that reload still refetches.
test('a join reload after an event during a fetch still refetches', async () => {
  const gates: (() => void)[] = [];
  const fetch = vi.fn(() => new Promise<number>((res) => { gates.push(() => res(gates.length)); }));
  const h = renderHook(() => useResource('k', { fetch, matches: matchAll }));
  await settle();
  await emit({ id: 'r-1' });
  act(() => h.result.current.reload({ join: true }));
  expect(fetch).toHaveBeenCalledTimes(1);
  await act(async () => { gates[0](); });
  await settle();
  expect(fetch).toHaveBeenCalledTimes(2);
});
