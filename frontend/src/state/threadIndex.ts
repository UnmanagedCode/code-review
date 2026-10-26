import { useEffect, useState } from 'react';
import type { FileState, Thread } from '@/lib/types';
import { diffKey, diffSpec } from './diffResource';
import { ensure } from './resource';

const CONCURRENCY = 4;

/**
 * Every non-outdated thread of the review. No REST call lists them, so this reads the diff of each file whose counts show
 * threads (never the whole diff, which can be huge) through the same cache entries as the open file, and fetches only files
 * whose `sig` moved. Without a `sig` it falls back to refetching every file when `version` moves. Idle until `enabled`.
 * `round`: a past round's threads, as of then.
 */
export function useThreadIndex(reviewId: string, files: FileState[], version: number, enabled: boolean, round?: number) {
  const [state, setState] = useState<{ threads: Thread[]; loading: boolean; error: unknown }>({ threads: [], loading: false, error: undefined });
  const withThreads = files.filter((f) => f.threads.open + f.threads.resolved > 0);
  const key = withThreads.map((f) => `${f.path}\0${f.sig ?? `v${version}`}`).join('\n');
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    const queue = [...withThreads];
    const found: Thread[] = [];
    const worker = async () => {
      for (let p = queue.shift(); p !== undefined; p = queue.shift()) {
        const d = await ensure(diffKey(reviewId, round, p.path), diffSpec(reviewId, round, p.path, () => String(version)), (c) => p.sig !== undefined && c.sig === p.sig);
        found.push(...d.threads);
      }
    };
    Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker)).then(
      () => { if (live) setState({ threads: found, loading: false, error: undefined }); },
      (error) => { if (live) setState({ threads: [], loading: false, error }); },
    );
    return () => { live = false; };
  }, [reviewId, key, enabled, round]);
  return state;
}
