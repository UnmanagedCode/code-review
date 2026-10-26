import type { Route } from './route';

export type Prefill = { kind: 'range'; base: string; head: string } | { kind: 'commit'; sha: string } | { error: string };

/**
 * The New review prefill a route's `range`/`sha` asks for; null when it asks for none. `range` splits at the first
 * `...`, else the first `..` (no git ref contains `..`). Refs are not checked here: the server's `checkRef` is the one validator.
 */
export function parsePrefill(route: Pick<Route, 'range' | 'sha'>): Prefill | null {
  const { range, sha } = route;
  if (range !== undefined && sha !== undefined) return { error: 'It names both a range and a commit' };
  if (sha !== undefined) return { kind: 'commit', sha };
  if (range === undefined) return null;
  const sep = range.includes('...') ? '...' : '..';
  const at = range.indexOf(sep);
  if (at < 0) return { error: `The range "${range}" has no ".." or "..."` };
  const base = range.slice(0, at);
  const head = range.slice(at + sep.length);
  if (!base || !head) return { error: `The range "${range}" is missing a side` };
  return { kind: 'range', base, head };
}
