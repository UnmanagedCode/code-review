import { GitCompareArrowsIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { RouteLink } from '@/components/RouteLink';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import * as ep from '@/lib/endpoints';
import { LEAVE_FILE, navigate, type Route } from '@/lib/route';
import type { Round } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useReviewCtx } from '@/state/reviewContext';
import { useFetch } from '@/state/useFetch';
import { CodeGitLink } from '@/features/common/CodeGitLink';
import { ErrorState, Loading } from '@/features/common/States';

const head7 = (r: Round) => r.headSha.slice(0, 7);

/** The two ends of a comparison, each limited so From stays before To. */
function CompareSelects({ rounds, current, compare }: { rounds: Round[]; current: number; compare: { from: number; to: number } }) {
  const label = (r: Round) => `Round ${r.n} · ${head7(r)}${r.n === current ? ' (current)' : ''}`;
  const pick = (from: number, to: number) => navigate({ compare: `${from}..${to}`, ...LEAVE_FILE });
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-1 px-3 pt-3 text-sm">
      <label htmlFor="rp-from">From</label>
      <NativeSelect className="w-full" size="sm" id="rp-from" value={String(compare.from)} onChange={(e) => pick(Number(e.target.value), compare.to)}>
        {rounds.filter((r) => r.n < compare.to).map((r) => <option key={r.n} value={String(r.n)}>{label(r)}</option>)}
      </NativeSelect>
      <label htmlFor="rp-to">To</label>
      <NativeSelect className="w-full" size="sm" id="rp-to" value={String(compare.to)} onChange={(e) => pick(compare.from, Number(e.target.value))}>
        {rounds.filter((r) => r.n > compare.from).map((r) => <option key={r.n} value={String(r.n)}>{label(r)}</option>)}
      </NativeSelect>
    </div>
  );
}

function Entry({ to, current, depth = 0, children }: { to: Route; current: boolean; depth?: number; children: ReactNode }) {
  return (
    <RouteLink
      to={to}
      aria-current={current ? 'true' : undefined}
      className={cn('flex min-h-9 items-center gap-x-2 py-1 pr-3 text-sm hover:bg-accent', current && 'bg-accent')}
      style={{ paddingLeft: `${0.75 + depth * 0.875}rem` }}
    >
      {children}
    </RouteLink>
  );
}

/** Range reviews: every round, newest first, with the current round's commits under it, and the round comparison. */
export function HistoryList() {
  const { id, review, rounds, round, compare, commit } = useReviewCtx();
  const commits = useFetch(() => ep.reviewCommits(id), [id, review.round]);
  const newestFirst = [...rounds].sort((a, b) => b.n - a.n);
  const currentHead = rounds.find((r) => r.n === review.round)?.headSha ?? review.headSha;
  const live = round === undefined && !compare && !commit;
  const ends = (n: number) => compare && (n === compare.from ? 'From' : n === compare.to ? 'To' : undefined);
  const endBadge = (n: number) => { const e = ends(n); return e && <>{' '}<Badge variant="secondary">{e}</Badge></>; };
  // Commits belong to the current round only (the endpoint lists that round's): picking one leaves any past view.
  let commitList: ReactNode;
  if (commits.error) commitList = <ErrorState error={commits.error} onRetry={commits.reload} />;
  else if (!commits.data) commitList = <Loading label="Loading commits" rows={2} />;
  else if (commits.data.commits.length) {
    commitList = (
      <ul>
        {commits.data.commits.map((c) => (
          <li key={c.sha} className="grid grid-cols-[minmax(0,1fr)_auto] items-center">
            <Entry to={{ commit: c.sha, round: undefined, compare: undefined, ...LEAVE_FILE }} current={commit === c.sha} depth={1}>
              <span className="shrink-0 font-mono text-xs text-muted-foreground">{c.short}</span>{' '}
              <span className="min-w-0 flex-1 truncate">{c.subject}</span>
            </Entry>
            <CodeGitLink target={{ project: review.project, worktree: review.worktree, commit: c.sha }} label={`Open ${c.short} in code-git`} />
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div className="flex flex-col">
      {compare ? <CompareSelects rounds={newestFirst} current={review.round} compare={compare} />
        : rounds.length >= 2 && (
          <div className="px-3 pt-3">
            <Button size="sm" variant="outline"
              onClick={() => navigate({ compare: `${review.round - 1}..${review.round}`, round: undefined, commit: undefined, ...LEAVE_FILE })}>
              <GitCompareArrowsIcon />Compare rounds
            </Button>
          </div>
        )}
      <nav aria-label="History" className="pt-2">
        <ul>
          <li>
            <Entry to={{ round: undefined, compare: undefined, commit: undefined, ...LEAVE_FILE }} current={live}>
              <span className="min-w-0 flex-1 truncate">Round {review.round} (current) · {currentHead.slice(0, 7)}</span>{endBadge(review.round)}
            </Entry>
            {commitList}
          </li>
          {newestFirst.filter((r) => r.n < review.round).map((r) => (
            <li key={r.n}>
              <Entry to={{ round: String(r.n), compare: undefined, commit: undefined, ...LEAVE_FILE }} current={round === r.n}>
                <span className="min-w-0 flex-1 truncate">Round {r.n} · {head7(r)}</span>{endBadge(r.n)}
              </Entry>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
