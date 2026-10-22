import { cn } from '@/lib/utils';
import { useReviewCtx, type ReviewCtx } from '@/state/reviewContext';

const short = (sha: string | undefined) => sha?.slice(0, 7);

/** What the diff and the threads show: the round, commit, past round or comparison, named in one line. */
export function scopeLabel({ review, rounds, round, compare, commit }: Pick<ReviewCtx, 'review' | 'rounds' | 'round' | 'compare' | 'commit'>): string {
  const head = (n: number) => short(rounds.find((r) => r.n === n)?.headSha ?? (n === review.round ? review.headSha : undefined));
  const parts = (...p: (string | undefined)[]) => p.filter(Boolean).join(' · ');
  if (review.kind === 'commit') return `Commit ${short(review.headSha)}`;
  if (review.kind === 'uncommitted') return parts(`Round ${review.round}`, 'working tree');
  if (compare) return `Round ${compare.from} → ${compare.to} · read-only`;
  if (round !== undefined) return parts(`Round ${round}`, head(round), 'read-only');
  if (commit) return parts(`Round ${review.round}`, `commit ${short(commit)}`);
  return parts(`Round ${review.round}`, head(review.round));
}

/** The scope line above the pane's tabs, on every tab. With `onShowHistory` (range reviews) it opens History. */
export function ScopeIndicator({ onShowHistory }: { onShowHistory?: () => void }) {
  const label = scopeLabel(useReviewCtx());
  const cls = 'mx-3 mt-3 w-fit max-w-[calc(100%-1.5rem)] truncate text-left text-xs text-muted-foreground';
  if (!onShowHistory) return <p className={cls}>{label}</p>;
  return (
    <button type="button" className={cn(cls, 'rounded-sm hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none')} onClick={onShowHistory}>
      {label}<span className="sr-only"> — show history</span>
    </button>
  );
}
