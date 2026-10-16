import { RouteLink } from '@/components/RouteLink';
import { Badge } from '@/components/ui/badge';
import type { ReviewSummary } from '@/lib/types';

export function ReviewRow({ review: r, showWorktree }: { review: ReviewSummary; showWorktree: boolean }) {
  const hunks = r.counts.hunks;
  return (
    <li>
      <RouteLink
        to={{ project: r.project, worktree: r.worktree ?? undefined, review: r.id, file: undefined, lines: undefined, side: undefined, thread: undefined, commit: undefined, view: undefined }}
        className="flex flex-col gap-1 border-b px-3 py-2.5 hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
      >
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{r.title || r.label}</span>
          {!r.seenByHuman && <Badge variant="info">new</Badge>}
          {r.unread > 0 && <Badge variant="default" aria-label={`${r.unread} unread`}>{r.unread}</Badge>}
        </span>
        <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <Badge variant="outline">{r.kind}</Badge>
          {r.status === 'closed' && <Badge variant="secondary">closed</Badge>}
          {showWorktree && <span>{r.worktree ?? 'main checkout'}</span>}
          <span>round {r.round}</span>
          {r.counts.files != null && <span>{r.counts.files} files</span>}
          {hunks && 'pending' in hunks && <span>{hunks.accepted} accepted · {hunks.rejected} rejected · {hunks.pending} pending</span>}
          {r.counts.threads.open > 0 && <span>{r.counts.threads.open} open threads</span>}
          {r.mergeBlockers > 0 && <Badge variant="destructive">{r.mergeBlockers} blocking</Badge>}
          {r.headMoved && <Badge variant="warning">HEAD moved</Badge>}
        </span>
      </RouteLink>
    </li>
  );
}
