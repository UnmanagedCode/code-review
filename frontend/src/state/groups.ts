import { toast } from 'sonner';
import * as ep from '@/lib/endpoints';
import { withGroupVerdict } from '@/lib/guide';
import { errorText, STALE_DIFF } from '@/lib/refusals';
import type { Verdict } from '@/lib/types';
import { forgetCleared } from './clearedGroups';
import { useReviewCtx } from './reviewContext';

/**
 * Group writes. Optimistic on the group's own control only: its hunks change when the response lists them, so the write
 * rules stay in the backend (`src/grouping.js`).
 */
export function useGroupActions() {
  const { id, diffs, patchGuide, reload, applyReview } = useReviewCtx();
  return {
    async setGroupVerdict(groupId: string, verdict: Verdict, previous: Verdict) {
      patchGuide((g) => withGroupVerdict(g, groupId, verdict));
      forgetCleared(id, groupId);
      try {
        const res = await ep.setGroupVerdict(id, groupId, verdict);
        applyReview(res.review);
        patchGuide(() => res.guide);
        const fileOf = new Map([...res.guide.groups.flatMap((g) => g.hunks), ...(res.guide.ungrouped ?? [])].map((h) => [h.id, h.file]));
        const byFile = new Map<string, Record<string, Verdict>>();
        for (const h of res.hunks) {
          const file = fileOf.get(h.id);
          if (file) byFile.set(file, { ...byFile.get(file), [h.id]: h.verdict });
        }
        byFile.forEach((verdicts, file) => diffs.patchVerdicts(file, verdicts));
        res.fileSigs.forEach((fs) => diffs.patchSig(fs));
        reload();
      } catch (e) {
        patchGuide((g) => withGroupVerdict(g, groupId, previous));
        toast.error(errorText(e));
        const code = (e as { code?: string }).code;
        if (code && (STALE_DIFF.has(code) || code === 'GROUP_UNKNOWN' || code === 'NO_GROUPS')) reload();
      }
    },
  };
}
