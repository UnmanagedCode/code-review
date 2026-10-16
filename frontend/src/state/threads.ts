import { toast } from 'sonner';
import * as ep from '@/lib/endpoints';
import { errorText, STALE_DIFF } from '@/lib/refusals';
import type { Severity, Thread, ThreadAnchorInput, ThreadKind, Verdict } from '@/lib/types';
import { useReviewCtx } from './reviewContext';

/** Write actions on the open review. Each returns undefined after toasting a refusal, and refetches when the diff proved stale. */
export function useReviewActions() {
  const ctx = useReviewCtx();
  const { id, fileDiff, reload, applyReview } = ctx;

  async function guard<T>(fn: () => Promise<T>): Promise<T | undefined> {
    try {
      return await fn();
    } catch (e) {
      toast.error(errorText(e));
      const code = (e as { code?: string }).code;
      if (code && (STALE_DIFF.has(code) || code === 'THREAD_DROPPED' || code === 'THREAD_UNKNOWN')) reload();
      return undefined;
    }
  }
  const landed = (thread: Thread) => { fileDiff.patchThread(thread); reload(); return thread; };

  return {
    createThread: (input: { anchor: ThreadAnchorInput; kind: ThreadKind; severity?: Severity; body: string }) =>
      guard(async () => landed((await ep.createThread(id, input)).thread)),
    reply: (tid: string, body: string) => guard(async () => landed((await ep.replyThread(id, tid, body)).thread)),
    setStatus: (tid: string, status: 'open' | 'resolved', disposition?: 'fixed' | 'dismissed') =>
      guard(async () => landed((await ep.setThreadStatus(id, tid, status, disposition)).thread)),
    markRead: (threadId?: string) => guard(async () => { applyReview((await ep.markRead(id, threadId)).review); reload(); }),
    /** Optimistic: flips at once, reverts on refusal. */
    async setVerdict(hunkId: string, verdict: Verdict, previous: Verdict | null) {
      fileDiff.patchVerdict(hunkId, verdict);
      try {
        applyReview((await ep.setVerdict(id, hunkId, verdict)).review);
        reload();
      } catch (e) {
        if (previous) fileDiff.patchVerdict(hunkId, previous);
        toast.error(errorText(e));
      }
    },
  };
}
