import { useEffect, useMemo, useRef } from 'react';
import * as ep from '@/lib/endpoints';
import { onFile } from '@/lib/ranges';
import type { DiffFile, FileSig, Thread, Verdict } from '@/lib/types';
import { resourceKey } from './checkout';
import { mutateResource, useResource, type Spec } from './resource';

/** The cache key of one file's diff in the live view (`round` undefined) or a past round. */
export const diffKey = (reviewId: string, round: number | undefined, path: string): string =>
  resourceKey('diff', reviewId, round === undefined ? '' : String(round), path);

/**
 * Never aged out: a file's diff is refetched when its `sig` moves, not by time or events.
 */
export const diffSpec = (reviewId: string, round: number | undefined, path: string): Spec<DiffFile> => ({
  fetch: async () => (await (round ? ep.roundDiff(reviewId, round, path) : ep.diff(reviewId, path))).files[0],
  maxAgeMs: Infinity,
});

/**
 * One file's cached diff, refetched when the view's `sig` for it differs from the cached diff's. Compared once per
 * (file, view sig): a local patch (`patchSig`) moves the cached sig ahead of the view's until the review reloads, and must
 * not read as a stale diff. `path` null/undefined = idle. `sig` undefined until the view's file list has loaded.
 */
export function useDiffEntry(reviewId: string, round: number | undefined, path: string | null | undefined, sig: string | undefined) {
  const key = path ? diffKey(reviewId, round, path) : null;
  const fetched = useResource(key, diffSpec(reviewId, round, path ?? ''), { keepPrevious: true });
  const switching = fetched.placeholder;
  const compared = useRef('');
  useEffect(() => {
    if (!key || sig === undefined || switching || fetched.loading || !fetched.data) return;
    const id = `${key}\0${sig}`;
    if (compared.current === id) return;
    compared.current = id;
    if (fetched.data.sig !== sig) fetched.reload();
  }, [key, sig, switching, fetched.loading, fetched.data]);
  return fetched;
}

/** Local patches of any file's cached live diff (verdict UIs exist only in the live view, so `round` is undefined). */
export interface DiffPatchers {
  patchVerdicts: (path: string, verdicts: Record<string, Verdict>) => void;
  /** Files the thread under its anchor's file; a review or group thread belongs to none. */
  patchThread: (thread: Thread) => void;
  /** The server's new sig for a file a write touched; null = unknown (a review or group thread's write touched no file). */
  patchSig: (fileSig: FileSig | null) => void;
}

export function diffPatchers(reviewId: string): DiffPatchers {
  const patch = (path: string, fn: (f: DiffFile) => DiffFile) => mutateResource<DiffFile>(diffKey(reviewId, undefined, path), fn);
  return {
    patchVerdicts: (path, verdicts) => patch(path, (f) => ({ ...f, hunks: f.hunks.map((h) => (verdicts[h.id] ? { ...h, verdict: verdicts[h.id] } : h)) })),
    patchThread: (t) => {
      if (!onFile(t.anchor)) return;
      patch(t.anchor.file, (f) => {
        const rest = f.threads.filter((x) => x.id !== t.id);
        return { ...f, threads: t.status !== 'outdated' ? [...rest, t].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true })) : rest };
      });
    },
    patchSig: (fs) => { if (fs?.sig) patch(fs.path, (f) => ({ ...f, sig: fs.sig! })); },
  };
}

export const useDiffPatchers = (reviewId: string): DiffPatchers => useMemo(() => diffPatchers(reviewId), [reviewId]);
