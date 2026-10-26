import { useCallback, useRef, useSyncExternalStore } from 'react';
import { onReconnect, subscribe, type ReviewEvent } from '@/lib/sse';
import type { Fetched } from './useFetch';

/** How long data with live git fields counts as fresh when a consumer (re)mounts. */
export const MAX_AGE_MS = 30_000;
export const DEBOUNCE_MS = 300;
/** Unmounted entries kept, least recently used first out: file diffs can be large. */
const MAX_IDLE_ENTRIES = 32;

export interface Spec<T> {
  fetch: () => Promise<T>;
  /** SSE invalidation; gets the cached data (e.g. to compare `rev`). Absent: events never invalidate the entry. */
  matches?: (e: ReviewEvent, data: T | undefined) => boolean;
  /** An event after which the thing no longer exists: the entry drops its data, reports `gone` and is never fetched again. */
  gone?: (e: ReviewEvent, data: T | undefined) => boolean;
  /** Revalidate on mount when older than this. */
  maxAgeMs?: number;
  /** Read when a fetch starts and kept with the data it returns (`Resource.dataTag`): the baseline a consumer compares later. */
  tag?: () => string;
}
export type Resource<T> = Omit<Fetched<T>, 'reload'> & {
  /** `join`: do nothing if a fetch that started after the last invalidation is already running (a poll or focus kick). */
  reload: (opts?: { join?: boolean }) => void;
  loadedAt: number;
  /** The `spec.tag` of the fetch that produced `data`. */
  dataTag?: string;
  /** A `spec.gone` event dropped the entry's data: it was deleted. */
  gone: boolean;
  /** `keepPrevious` is showing the previous key's data while this key loads. */
  placeholder: boolean;
};

interface Snap<T> { data?: T; error?: unknown; loading: boolean; loadedAt: number; version: number; dataTag?: string; gone: boolean }
interface Entry<T> {
  key: string;
  spec: Spec<T>;
  data?: T;
  error?: unknown;
  loading: boolean;
  loadedAt: number;
  /** Successful loads of this key, across mounts and evictions (`lastLoads`): what `Fetched.version` reports. */
  loads: number;
  dataTag?: string;
  gone: boolean;
  /** `gen` when the running fetch started. */
  startedGen: number;
  stale: boolean;
  /** `gen` at the last invalidation: a fetch that started before it cannot clear `stale`. */
  staleGen: number;
  inflight?: Promise<void>;
  timer?: ReturnType<typeof setTimeout>;
  listeners: Set<() => void>;
  snap: Snap<T>;
}

// Entries of every data type share one table; `any` keeps `Entry<T>` assignable to it (the spec is contravariant in T).
type AnyEntry = Entry<any>;
const entries = new Map<string, AnyEntry>();
/** Keys of entries with no listener, oldest first. */
const idle = new Set<string>();
/** `loads` of evicted entries, so a recreated entry's version keeps rising: consumers compare versions across a remount. */
const lastLoads = new Map<string, number>();
const MAX_REMEMBERED_LOADS = 256;
let gen = 0;
let offSse: (() => void)[] | null = null;
let listeningVisibility = false;

const visible = () => document.visibilityState !== 'hidden';
const wanted = (e: AnyEntry) => e.listeners.size > 0 && visible();

function publish<T>(e: Entry<T>): void {
  e.snap = { data: e.data, error: e.error, loading: e.loading, loadedAt: e.loadedAt, version: e.loads, dataTag: e.dataTag, gone: e.gone };
  e.listeners.forEach((l) => l());
}
const invalidate = (e: AnyEntry) => { e.stale = true; e.staleGen = ++gen; };

/** One fetch per key at a time; asking again while one runs shares it. */
function load<T>(e: Entry<T>): Promise<void> {
  if (e.inflight) return e.inflight;
  const started = gen;
  const tag = e.spec.tag?.();
  e.startedGen = started;
  e.loading = true;
  publish(e);
  e.inflight = Promise.resolve()
    .then(() => e.spec.fetch())
    .then(
      (data) => {
        e.data = data; e.dataTag = tag; e.error = undefined; e.loadedAt = Date.now(); e.loads++;
        if (e.staleGen <= started) e.stale = false;
      },
      (error) => { e.error = error; },
    )
    .then(() => {
      e.inflight = undefined;
      e.loading = false;
      publish(e);
      // Invalidated while this fetch ran: it may predate the change.
      if (e.stale && e.staleGen > started && wanted(e)) void load(e);
    });
  return e.inflight;
}

function scheduleLoad(e: AnyEntry): void {
  clearTimeout(e.timer);
  e.timer = setTimeout(() => { e.timer = undefined; if (wanted(e)) void load(e); }, DEBOUNCE_MS);
}

function touchIdle(e: AnyEntry): void {
  if (entries.get(e.key) !== e) return;
  idle.delete(e.key);
  idle.add(e.key);
  while (idle.size > MAX_IDLE_ENTRIES) {
    const oldest = idle.values().next().value as string;
    idle.delete(oldest);
    const dropped = entries.get(oldest);
    clearTimeout(dropped?.timer);
    if (dropped) {
      lastLoads.delete(oldest);
      lastLoads.set(oldest, dropped.loads);
      if (lastLoads.size > MAX_REMEMBERED_LOADS) lastLoads.delete(lastLoads.keys().next().value as string);
    }
    entries.delete(oldest);
  }
}

function wireVisibility(): void {
  if (listeningVisibility) return;
  listeningVisibility = true;
  document.addEventListener('visibilitychange', () => {
    if (!visible()) return;
    for (const e of entries.values()) if (e.listeners.size && e.stale) void load(e);
  });
}
function wireSse(): void {
  offSse ??= [
    subscribe((ev) => {
      for (const e of entries.values()) {
        if (e.spec.gone?.(ev, e.data)) {
          clearTimeout(e.timer);
          e.timer = undefined;
          e.data = undefined;
          e.gone = true;
          publish(e);
          continue;
        }
        if (!e.spec.matches?.(ev, e.data)) continue;
        invalidate(e);
        if (wanted(e)) scheduleLoad(e);
      }
    }),
    onReconnect(() => {
      for (const e of entries.values()) {
        if (!e.spec.matches) continue;
        invalidate(e);
        if (wanted(e)) void load(e);
      }
    }),
  ];
}

/** `track`: no component will mount it (`ensure`), so it counts as idle at once; a hook's entry joins the LRU when it unmounts. */
function entryFor<T>(key: string, spec: Spec<T>, track = false): Entry<T> {
  let e = entries.get(key) as Entry<T> | undefined;
  if (!e) {
    const loads = lastLoads.get(key) ?? 0;
    lastLoads.delete(key);
    e = { key, spec, loading: false, loadedAt: 0, loads, gone: false, startedGen: 0, stale: false, staleGen: 0, listeners: new Set(), snap: { loading: false, loadedAt: 0, version: loads, gone: false } };
    entries.set(key, e as AnyEntry);
    if (track) touchIdle(e);
  }
  e.spec = spec;
  if (spec.matches || spec.gone) wireSse();
  wireVisibility();
  return e;
}

function mount<T>(e: Entry<T>): void {
  if (e.gone) return;
  if (e.data === undefined) { if (!e.inflight) void load(e); return; }
  if (Date.now() - e.loadedAt > (e.spec.maxAgeMs ?? MAX_AGE_MS)) invalidate(e);
  if (e.stale && visible()) void load(e);
}

function attach<T>(e: Entry<T>, cb: () => void): () => void {
  e.listeners.add(cb);
  idle.delete(e.key);
  mount(e);
  return () => {
    e.listeners.delete(cb);
    if (e.listeners.size) return;
    clearTimeout(e.timer);
    e.timer = undefined;
    touchIdle(e);
  };
}

function patch<T>(e: Entry<T>, fn: (d: T) => T): void {
  if (e.data === undefined) return;
  e.data = fn(e.data);
  publish(e);
}

const IDLE: Snap<never> = { loading: false, loadedAt: 0, version: 0, gone: false };
const NOOP = () => {};

/**
 * Data under `key`, shared by every hook with that key and kept across mounts. Mounting renders cached data at once and
 * revalidates it in the background when stale or older than `maxAgeMs`. SSE events matching `spec.matches` mark it stale; a
 * mounted entry then refetches (debounced), but never while the tab is hidden: it refetches when the tab shows again.
 * `key` null = idle. `keepPrevious`: while a new key has no data, show the last data shown, with `placeholder` set.
 */
export function useResource<T>(key: string | null, spec: Spec<T>, opts: { keepPrevious?: boolean } = {}): Resource<T> {
  const entry = key === null ? null : entryFor(key, spec);
  const sub = useCallback((cb: () => void) => (entry ? attach(entry, cb) : NOOP), [entry]);
  const snap = useSyncExternalStore(sub, () => (entry ? entry.snap : (IDLE as Snap<T>)));
  const reload = useCallback((opts?: { join?: boolean }) => {
    if (!entry) return;
    // A fetch that started after the last invalidation already reads the state a kick would ask for.
    if (opts?.join === true && entry.inflight && entry.startedGen >= entry.staleGen) return;
    invalidate(entry);
    void load(entry);
  }, [entry]);
  const mutate = useCallback((fn: (d: T) => T) => { if (entry) patch(entry, fn); }, [entry]);
  const last = useRef<T | undefined>(undefined);
  if (key === null) last.current = undefined;
  else if (snap.data !== undefined) last.current = snap.data;
  const pending = key !== null && snap.data === undefined && !snap.error && !snap.gone;
  const placeholder = !!opts.keepPrevious && pending && last.current !== undefined;
  return {
    data: placeholder ? last.current : snap.data, error: snap.error, loading: snap.loading || pending, version: snap.version,
    loadedAt: snap.loadedAt, dataTag: snap.dataTag, gone: snap.gone, placeholder, reload, mutate,
  };
}

/**
 * The data under `key` without a component: cached when `isCurrent` accepts it (any cached data without `isCurrent`),
 * else fetched. Throws the fetch's error when it fails.
 */
export async function ensure<T>(key: string, spec: Spec<T>, isCurrent?: (data: T) => boolean): Promise<T> {
  const e = entryFor(key, spec, true);
  if (e.data !== undefined && !e.stale && (!isCurrent || isCurrent(e.data))) return e.data;
  const before = e.loads;
  await load(e);
  if (e.loads === before && e.error) throw e.error;
  return e.data as T;
}

/** Patches the cached data under `key`, for every mount. */
export function mutateResource<T>(key: string, fn: (d: T) => T): void {
  const e = entries.get(key) as Entry<T> | undefined;
  if (e) patch(e, fn);
}

/** Test isolation: drop every entry and the SSE subscriptions. */
export function resetResources(): void {
  for (const e of entries.values()) clearTimeout(e.timer);
  entries.clear();
  idle.clear();
  lastLoads.clear();
  offSse?.forEach((off) => off());
  offSse = null;
}
