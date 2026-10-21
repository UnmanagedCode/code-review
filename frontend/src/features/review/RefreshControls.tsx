import { RefreshCwIcon, XIcon } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useReviewAdmin } from '@/state/admin';
import { useReviewCtx } from '@/state/reviewContext';
import { Spinner } from '@/features/common/States';

/** The refresh cue (range: HEAD-moved banner; uncommitted: a button) and the last refresh's outcome. Commit reviews, past-round views and comparisons have no refresh. */
export function RefreshControls() {
  const { review, pastView } = useReviewCtx();
  const admin = useReviewAdmin();
  const r = admin.report;
  const canRefresh = review.status === 'open' && !review.checkoutGone && !pastView;
  const button = (
    <Button size="sm" variant="outline" disabled={admin.refreshing} onClick={admin.refresh}>
      {admin.refreshing ? <Spinner /> : <RefreshCwIcon />}Refresh
    </Button>
  );
  return (
    <>
      {review.kind === 'range' && review.headMoved && canRefresh && (
        <Alert variant="info" className="mx-3 mt-3 w-auto">
          <AlertDescription className="flex-row flex-wrap items-center"><span>HEAD moved — Refresh available</span>{button}</AlertDescription>
        </Alert>
      )}
      {review.kind === 'uncommitted' && canRefresh && <div className="flex justify-end px-3 pt-3">{button}</div>}
      {r && (
        <Alert className="mx-3 mt-3 w-auto" aria-label="Refresh result">
          <AlertDescription className="flex-row items-center">
            <span className="flex-1">
              {r.unchanged
                ? `No changes; still round ${r.round}`
                : `Round ${r.round}: hunks ${r.hunks!.kept} kept, ${r.hunks!.reset} reset, ${r.hunks!.new} new; threads ${r.threads!.moved} moved, ${r.threads!.drifted} drifted, ${r.threads!.outdated} outdated, ${r.threads!.dropped} dropped`}
            </span>
            <Button size="icon-sm" variant="ghost" aria-label="Dismiss" onClick={admin.dismissReport}><XIcon /></Button>
          </AlertDescription>
        </Alert>
      )}
    </>
  );
}
