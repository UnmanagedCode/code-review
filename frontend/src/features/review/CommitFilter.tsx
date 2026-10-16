import { navigate, useRoute } from '@/lib/route';
import { NativeSelect } from '@/components/ui/native-select';
import { useFetch } from '@/state/useFetch';
import * as ep from '@/lib/endpoints';
import { useReviewCtx } from '@/state/reviewContext';

/** Range reviews: view one commit's diff of the round, read-only. */
export function CommitFilter() {
  const { id, review } = useReviewCtx();
  const route = useRoute();
  const commits = useFetch(review.kind === 'range' ? () => ep.reviewCommits(id) : null, [id, review.round]);
  if (review.kind !== 'range' || !commits.data?.commits.length) return null;
  return (
    <div className="px-3 pt-3">
      <label className="sr-only" htmlFor="cf-commit">Commit filter</label>
      <NativeSelect className="w-full" size="sm" id="cf-commit" value={route.commit ?? ''}
        onChange={(e) => navigate({ commit: e.target.value || undefined, file: undefined, lines: undefined, thread: undefined })}>
        <option value="">All commits</option>
        {commits.data.commits.map((c) => <option key={c.sha} value={c.sha}>{c.short} {c.subject}</option>)}
      </NativeSelect>
    </div>
  );
}
