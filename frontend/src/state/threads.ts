import { toast } from 'sonner';
import * as ep from '@/lib/endpoints';
import { errorText, STALE_DIFF } from '@/lib/refusals';
import type { FileSig, Severity, Thread, ThreadAnchorInput, ThreadKind, Verdict } from '@/lib/types';
import { claimMark, releaseMark } from './readMarks';
import { useReviewCtx } from './reviewContext';

/** Write actions on the open review. Each returns undefined after toasting a refusal, and refetches when the diff proved stale. */
export function useReviewActions() {
  const ctx = useReviewCtx();
  const { id, fileDiff, reload, applyReview, version } = ctx;

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
  const landed = ({ thread, fileSig }: { thread: Thread; fileSig: FileSig }) => { fileDiff.patchThread(thread); fileDiff.patchSig(fileSig); reload(); return thread; };

  return {
    createThread: (input: { anchor: ThreadAnchorInput; kind: ThreadKind; severity?: Severity; body: string }) =>
      guard(async () => landed(await ep.createThread(id, input))),
    reply: (tid: string, body: string) => guard(async () => landed(await ep.replyThread(id, tid, body))),
    setStatus: (tid: string, status: 'open' | 'resolved', disposition?: 'fixed' | 'dismissed') =>
      guard(async () => landed(await ep.setThreadStatus(id, tid, status, disposition))),
    /** One thread (at most once per review version and visit, see `readMarks.ts`), or the whole review. */
    markRead: (threadId?: string) => {
      if (threadId !== undefined && !claimMark(id, threadId, version)) return Promise.resolve(undefined);
      return guard(async () => {
        try {
          applyReview((await ep.markRead(id, threadId)).review);
        } catch (e) {
          if (threadId !== undefined) releaseMark(id, threadId); // a refused mark may be asked again
          throw e;
        }
        reload();
      });
    },
    /** Optimistic: flips at once, reverts on refusal. */
    async setVerdict(hunkId: string, verdict: Verdict, previous: Verdict | null) {
      fileDiff.patchVerdict(hunkId, verdict);
      try {
        const done = await ep.setVerdict(id, hunkId, verdict);
        applyReview(done.review);
        fileDiff.patchSig(done.fileSig);
        reload();
      } catch (e) {
        if (previous) fileDiff.patchVerdict(hunkId, previous);
        toast.error(errorText(e));
      }
    },
    /**
     * Optimistic like setVerdict; `hunkIds` are the file's pending hunks, so a refusal reverts them to pending, then reloads:
     * the revert can clobber a per-hunk verdict set while this request was in flight.
     */
    async acceptFile(file: string, hunkIds: string[]) {
      hunkIds.forEach((h) => fileDiff.patchVerdict(h, 'accepted'));
      try {
        const done = await ep.acceptFile(id, file, hunkIds);
        applyReview(done.review);
        fileDiff.patchSig(done.fileSig);
        reload();
      } catch (e) {
        hunkIds.forEach((h) => fileDiff.patchVerdict(h, 'pending'));
        toast.error(errorText(e));
        reload();
      }
    },
  };
}
