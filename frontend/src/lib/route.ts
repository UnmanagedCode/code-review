import { useSyncExternalStore } from 'react';

export interface Route {
  project?: string; worktree?: string; review?: string; file?: string; side?: 'old' | 'new';
  lines?: string; thread?: string; commit?: string; round?: string; compare?: string; view?: 'new' | 'threads' | 'history' | 'guided' | 'inbox';
  /** Guided tab: a group id (current or retired) or `other` (the hunks in no group). */
  step?: string;
  /** New review prefill (`view=new`), kept raw: `lib/prefill.ts` reads them so the dialog can say why one is unusable. */
  range?: string; sha?: string;
}
const KEYS = ['project', 'worktree', 'review', 'file', 'side', 'lines', 'thread', 'commit', 'round', 'compare', 'view', 'step', 'range', 'sha'] as const;

/**
 * Every key that belongs to the open review (its file position, filters, views). Spread it into any patch that opens,
 * leaves or deletes a review, so nothing of one review leaks into the next: `navigate` merges into the current route.
 */
export const REVIEW_SCOPED = {
  file: undefined, side: undefined, lines: undefined, thread: undefined, commit: undefined, round: undefined, compare: undefined, view: undefined, step: undefined,
  range: undefined, sha: undefined,
} as const satisfies Route;

/** Closes the New review dialog and drops its prefill, so the next one opens with the defaults. */
export const NEW_REVIEW_CLOSED = { view: undefined, range: undefined, sha: undefined } as const satisfies Route;

/** Leaves the open file position (file, lines, side, focused thread) and nothing else: filters, views, the pane tab and the guided step stay. */
export const LEAVE_FILE = { file: undefined, lines: undefined, side: undefined, thread: undefined } as const satisfies Route;

const COMPARE_RE = /^([1-9]\d*)\.\.([1-9]\d*)$/;

/** `A..B` → the two rounds of a comparison; null when absent or malformed. Order is not checked here. */
export function parseCompare(s: string | undefined): { from: number; to: number } | null {
  const m = COMPARE_RE.exec(s ?? '');
  return m ? { from: Number(m[1]), to: Number(m[2]) } : null;
}

export function parseRoute(search: string): Route {
  const p = new URLSearchParams(search);
  const route: Route = {};
  for (const k of KEYS) {
    const v = p.get(k);
    if (v === null || v === '') continue;
    if (k === 'side' && v !== 'old' && v !== 'new') continue;
    if (k === 'view' && v !== 'new' && v !== 'threads' && v !== 'history' && v !== 'guided' && v !== 'inbox') continue;
    if (k === 'step' && !/^(g[1-9]\d*|other)$/.test(v)) continue;
    if (k === 'lines' && !/^\d+(-\d+)?$/.test(v)) continue;
    if (k === 'round' && !/^[1-9]\d*$/.test(v)) continue;
    if (k === 'compare' && !COMPARE_RE.test(v)) continue;
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

// cc's `SCOPE_PARAMS` owns these names (cc docs/plugins.md, `menuItems`).
export const MENU_PARAMS = { project: 'ccProject', worktree: 'ccWorktree' } as const;

/** What a code-conductor row ⋮ "Show reviews" asks for: untrusted names, validated by the backend before any route is built. */
export type MenuTarget = { project: string | null; worktree: string | null };

/** null when the URL carries no menu param at all; an empty value counts as absent. */
export function readMenuTarget(search = location.search): MenuTarget | null {
  const q = new URLSearchParams(search);
  if (!q.has(MENU_PARAMS.project) && !q.has(MENU_PARAMS.worktree)) return null;
  return { project: q.get(MENU_PARAMS.project) || null, worktree: q.get(MENU_PARAMS.worktree) || null };
}

const listeners = new Set<() => void>();
let cached: { search: string; route: Route } | null = null;
const read = (): Route => {
  // cc's navigate replaces the whole query with its menu params: the page keeps its route until `useMenuTarget` strips them
  // and resolves the target, so an open review never unmounts while the click is pending and a failure changes nothing.
  if (cached && cached.search !== location.search && readMenuTarget()) return cached.route;
  if (!cached || cached.search !== location.search) cached = { search: location.search, route: parseRoute(location.search) };
  return cached.route;
};
/** Test seam: forgets the parsed route, as a fresh page load would. */
export const resetRoute = () => { cached = null; };

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
