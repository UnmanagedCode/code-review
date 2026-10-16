import { useSyncExternalStore } from 'react';

export interface Route {
  project?: string; worktree?: string; review?: string; file?: string; side?: 'old' | 'new';
  lines?: string; thread?: string; commit?: string; round?: string; view?: 'new' | 'threads';
}
const KEYS = ['project', 'worktree', 'review', 'file', 'side', 'lines', 'thread', 'commit', 'round', 'view'] as const;

export function parseRoute(search: string): Route {
  const p = new URLSearchParams(search);
  const route: Route = {};
  for (const k of KEYS) {
    const v = p.get(k);
    if (v === null || v === '') continue;
    if (k === 'side' && v !== 'old' && v !== 'new') continue;
    if (k === 'view' && v !== 'new' && v !== 'threads') continue;
    if (k === 'lines' && !/^\d+(-\d+)?$/.test(v)) continue;
    if (k === 'round' && !/^[1-9]\d*$/.test(v)) continue;
    (route as Record<string, string>)[k] = v;
  }
  return route;
}

export function toSearch(route: Route): string {
  const p = new URLSearchParams();
  for (const k of KEYS) if (route[k]) p.set(k, route[k]);
  const s = p.toString();
  return s ? `?${s}` : '?';
}

/** `10` or `10-20` → the range (start ≤ end); null when absent. */
export function parseLines(lines: string | undefined): { start: number; end: number } | null {
  const m = /^(\d+)(?:-(\d+))?$/.exec(lines ?? '');
  if (!m) return null;
  const a = Number(m[1]);
  const b = m[2] ? Number(m[2]) : a;
  return { start: Math.min(a, b), end: Math.max(a, b) };
}
export const formatLines = (start: number, end: number): string => (start === end ? String(start) : `${start}-${end}`);

const listeners = new Set<() => void>();
let cached: { search: string; route: Route } | null = null;
const read = (): Route => {
  if (!cached || cached.search !== location.search) cached = { search: location.search, route: parseRoute(location.search) };
  return cached.route;
};

/** Merge `patch` into the current route (`undefined` removes a key) and push it; `replace` swaps the entry instead. */
export function navigate(patch: Route | ((r: Route) => Route), opts: { replace?: boolean } = {}): void {
  const next = typeof patch === 'function' ? patch(read()) : { ...read(), ...patch };
  const search = toSearch(next);
  if (search === (location.search || '?')) return;
  history[opts.replace ? 'replaceState' : 'pushState'](null, '', search);
  listeners.forEach((l) => l());
}
/** Replace the whole route. */
export const navigateTo = (route: Route, opts: { replace?: boolean } = {}) => navigate(() => route, opts);

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  window.addEventListener('popstate', fn);
  return () => { listeners.delete(fn); window.removeEventListener('popstate', fn); };
}
export function useRoute(): Route {
  return useSyncExternalStore(subscribe, read);
}
