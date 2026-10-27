import * as cc from './cc.js';

/** How long a positive cc answer is reused across requests. */
export const DEFAULT_LOOKUP_TTL_MS = 10_000;

// Read per call, like CODE_REVIEW_CC_RETRY_MS; 0 turns cross-request reuse off.
const ttlMs = () => {
  const raw = process.env.CODE_REVIEW_LOOKUP_TTL_MS;
  const n = Math.floor(Number(raw));
  return raw !== undefined && raw !== '' && n >= 0 ? n : DEFAULT_LOOKUP_TTL_MS;
};

// key -> {at (monotonic ms, so a wall-clock jump never revives an answer), promise}. Keys: `l:<project>` (location row), `w:<project>` (worktree rows), `list` (every project).
// Concurrent callers share one in-flight promise; a rejection, and a null location, are never kept.
const cache = new Map();

function lookup(key, fetch, { fresh = false } = {}) {
  const hit = cache.get(key);
  if (!fresh && hit && performance.now() - hit.at < ttlMs()) return { promise: hit.promise, cached: true };
  const entry = { at: performance.now(), promise: fetch() };
  cache.set(key, entry);
  const drop = () => { if (cache.get(key) === entry) cache.delete(key); };
  entry.promise.then((v) => { if (v === null) drop(); }, drop);
  return { promise: entry.promise, cached: false };
}

/** Test seam: forgets every cached answer. */
export const _clearLookups = () => cache.clear();

/**
 * One request's view of cc's project metadata: each key is asked at most once per scope, through the cross-request cache.
 * A worktree missing from cached rows is re-asked once, bypassing the cache, before it counts as unknown.
 */
export function lookupScope() {
  const memo = new Map();
  const reasked = new Set();
  const get = (key, fetch) => {
    if (!memo.has(key)) memo.set(key, lookup(key, fetch));
    return memo.get(key);
  };
  const reask = (key, fetch) => {
    if (!reasked.has(key)) {
      reasked.add(key);
      memo.set(key, lookup(key, fetch, { fresh: true }));
    }
    return memo.get(key);
  };
  const worktreesOf = (project) => () => cc.worktrees(project);
  return {
    /** The project's location row {name, system, remoteId, path}, or null when cc does not know it. */
    project: (name) => get(`l:${name}`, () => cc.location(name)).promise,
    /** cc's worktree rows of the project. */
    worktrees: (project) => get(`w:${project}`, worktreesOf(project)).promise,
    /** One worktree's row, or null when cc does not list it. */
    async worktree(project, name) {
      const find = (rows) => rows.find((w) => w.worktreeName === name) ?? null;
      const first = get(`w:${project}`, worktreesOf(project));
      const row = find(await first.promise);
      if (row || !first.cached) return row;
      return find(await reask(`w:${project}`, worktreesOf(project)).promise);
    },
    /** Every project row (the picker). */
    list: () => get('list', () => cc.projects()).promise,
    /** Forgets the project's cached answers, after git contradicted them (its checkout path is missing). */
    evict(project) {
      cache.delete(`l:${project}`);
      cache.delete(`w:${project}`);
    },
  };
}
