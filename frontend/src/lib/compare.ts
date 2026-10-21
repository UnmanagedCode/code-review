import type { ComparedThread, FileState, Thread, ThreadCounts } from './types';

/** A thread shown once: the copy to render, and its other copy when both were present. */
export interface ShownThread<T extends Thread = Thread> { thread: T; other?: T }

const isFromCopy = (t: Thread) => (t as Partial<ComparedThread>).placement === 'from';

/**
 * One entry per thread id, in first-seen order. When a comparison has both copies of a thread, the to-copy (as of
 * round B) is kept and the from-copy rides along as `other`. Threads of a normal review have no copies: a no-op.
 */
export function dedupeCopies<T extends Thread>(threads: T[]): ShownThread<T>[] {
  const out = new Map<string, ShownThread<T>>();
  for (const t of threads) {
    const seen = out.get(t.id);
    if (!seen) out.set(t.id, { thread: t });
    else if (isFromCopy(seen.thread)) out.set(t.id, { thread: t, other: seen.thread });
    else out.set(t.id, { thread: seen.thread, other: t });
  }
  return [...out.values()];
}

/** A comparison file as the file tree shows it: thread counts over distinct threads, each at its shown copy's status. */
export function compareFileState(f: { path: string; oldPath: string | null; status: FileState['status']; binary: boolean; tooLarge: boolean; additions: number; deletions: number; hunks: unknown[]; threads: Thread[] }): FileState {
  const threads: ThreadCounts = { open: 0, resolved: 0, outdated: 0 };
  for (const { thread } of dedupeCopies(f.threads)) threads[thread.status]++;
  return { ...f, hunks: f.hunks.length, verdicts: null, threads, unread: 0 };
}
