import { useState } from 'react';
import { toast } from 'sonner';
import * as ep from '@/lib/endpoints';
import { errorText } from '@/lib/refusals';
import { navigate } from '@/lib/route';
import type { RefreshReport } from '@/lib/types';
import { useReviewCtx } from './reviewContext';

/** Review-level writes: close/reopen, recipient, delete, refresh. Refusals toast. */
export function useReviewAdmin() {
  const { id, applyReview, reload } = useReviewCtx();
  const [report, setReport] = useState<RefreshReport | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const attempt = async (fn: () => Promise<void>) => {
    try { await fn(); } catch (e) { toast.error(errorText(e)); }
  };
  return {
    report, refreshing, dismissReport: () => setReport(null),
    patch: (patch: Parameters<typeof ep.patchReview>[1]) => attempt(async () => { applyReview((await ep.patchReview(id, patch)).review); reload(); }),
    remove: () => attempt(async () => { await ep.deleteReview(id); navigate({ review: undefined, file: undefined, thread: undefined, lines: undefined, commit: undefined }); }),
    refresh: () => attempt(async () => {
      setRefreshing(true);
      try { setReport(await ep.refresh(id)); reload(); } finally { setRefreshing(false); }
    }),
  };
}
