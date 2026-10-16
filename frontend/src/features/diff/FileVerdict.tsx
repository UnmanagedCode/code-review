import { CheckCheckIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { DiffFile } from '@/lib/types';
import { useReviewCtx } from '@/state/reviewContext';
import { useReviewActions } from '@/state/threads';

/** File-header verdict tally and "Accept file". Counts come from the optimistic diff, so they move on click. */
export function FileVerdict({ file }: { file: DiffFile }) {
  const { review, commit } = useReviewCtx();
  const actions = useReviewActions();
  if (commit || review.kind === 'uncommitted') return null;
  const n = file.hunks.length;
  const accepted = file.hunks.filter((h) => h.verdict === 'accepted').length;
  const rejected = file.hunks.filter((h) => h.verdict === 'rejected').length;
  const pending = file.hunks.filter((h) => (h.verdict ?? 'pending') === 'pending').map((h) => h.id);
  return (
    <span className="inline-flex items-center gap-2 text-xs">
      <span className="text-muted-foreground">{accepted}/{n} accepted{rejected > 0 && ` · ${rejected} rejected`}</span>
      {n > 0 && accepted === n ? (
        <span className="inline-flex items-center gap-1 text-success"><CheckCheckIcon className="size-4" />All accepted</span>
      ) : (
        <Button
          size="sm"
          variant="outline"
          disabled={!pending.length || review.status === 'closed'}
          title={`Accept the ${pending.length} pending hunks${rejected > 0 ? '; rejected hunks stay rejected' : ''}`}
          onClick={() => actions.acceptFile(file.path, pending)}
        >
          Accept file
        </Button>
      )}
    </span>
  );
}
