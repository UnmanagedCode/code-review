import { PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { navigate } from '@/lib/route';
import { useReviewList } from '@/state/reviewList';
import { Empty, ErrorState, Loading } from '@/features/common/States';
import { ReviewRow } from './ReviewRow';

/** Reviews of the chosen checkout, or of every checkout of the project. */
export function ReviewList({ project, worktree }: { project: string; worktree: string | undefined }) {
  const [scope, setScope] = useState<'checkout' | 'project'>('checkout');
  const [status, setStatus] = useState('open');
  const list = useReviewList(project, scope === 'checkout' ? (worktree ?? '') : undefined, status);
  return (
    <section aria-label="Reviews" className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-2 border-b p-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium">Reviews</h2>
          <Button size="sm" className="ml-auto" onClick={() => navigate({ view: 'new' })}><PlusIcon />New review</Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="rl-scope">Scope</label>
          <NativeSelect size="sm" id="rl-scope" value={scope} onChange={(e) => setScope(e.target.value as 'checkout' | 'project')}>
            <option value="checkout">This checkout</option>
            <option value="project">All checkouts</option>
          </NativeSelect>
          <label className="sr-only" htmlFor="rl-status">Status</label>
          <NativeSelect size="sm" id="rl-status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="open">Open</option>
            <option value="closed">Closed</option>
            <option value="all">All</option>
          </NativeSelect>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {list.loading && !list.data ? <Loading label="Loading reviews" />
          : list.error && !list.data ? <ErrorState error={list.error} onRetry={list.reload} />
            : list.data && list.data.reviews.length === 0 ? <Empty title="No reviews yet">Start one with “New review”.</Empty>
              : <ul>{list.data?.reviews.map((r) => <ReviewRow key={r.id} review={r} showWorktree={scope === 'project'} />)}</ul>}
      </div>
    </section>
  );
}
