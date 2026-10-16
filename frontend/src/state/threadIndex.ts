import { useEffect, useState } from 'react';
import * as ep from '@/lib/endpoints';
import type { FileState, Thread } from '@/lib/types';

const CONCURRENCY = 4;

/**
 * Every non-outdated thread of the review. No REST call lists them, so this fetches the diff of each file whose counts
 * show threads (never the whole diff, which can be huge). Idle until `enabled`.
 */
export function useThreadIndex(reviewId: string, files: FileState[], version: number, enabled: boolean) {
  const [state, setState] = useState<{ threads: Thread[]; loading: boolean; error: unknown }>({ threads: [], loading: false, error: undefined });
  const withThreads = files.filter((f) => f.threads.open + f.threads.resolved > 0).map((f) => f.path);
  const key = withThreads.join('\n');
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    const queue = [...withThreads];
    const found: Thread[] = [];
    const worker = async () => {
      for (let p = queue.shift(); p !== undefined; p = queue.shift()) {
        found.push(...(await ep.diff(reviewId, p)).files.flatMap((f) => f.threads));
      }
    };
    Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker)).then(
      () => { if (live) setState({ threads: found, loading: false, error: undefined }); },
      (error) => { if (live) setState({ threads: [], loading: false, error }); },
    );
    return () => { live = false; };
  }, [reviewId, key, version, enabled]);
  return state;
}
