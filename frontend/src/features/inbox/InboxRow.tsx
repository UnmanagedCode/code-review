import { RouteLink } from '@/components/RouteLink';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { REVIEW_SCOPED } from '@/lib/route';
import type { InboxItem } from '@/lib/types';

/** One open review: a link into it, and a Close button beside it once cc no longer lists its checkout. */
export function InboxRow({ item: r, onClose }: { item: InboxItem; onClose: (id: string) => void }) {
  const name = r.title || r.label;
  return (
    <li className="flex items-stretch border-b">
      <RouteLink
        to={{ project: r.project, worktree: r.worktree ?? undefined, review: r.id, ...REVIEW_SCOPED }}
        className="flex min-w-0 flex-1 flex-col gap-1 px-3 py-2.5 hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
      >
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
          {!r.seenByHuman && <Badge variant="info">new</Badge>}
          {r.unread > 0 && <Badge variant="default" aria-label={`${r.unread} unread`}>{r.unread}</Badge>}
        </span>
        <span className="truncate text-xs text-muted-foreground">{r.project} · {r.worktree ?? 'main checkout'}</span>
        <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {r.turn === 'human' ? <Badge variant="info">Your turn</Badge> : <Badge variant="secondary">Waiting on agent</Badge>}
          <Badge variant="outline">{r.kind}</Badge>
          <span>round {r.round}</span>
          {r.checkoutGone === true && <Badge variant="warning">checkout gone</Badge>}
        </span>
      </RouteLink>
      {r.checkoutGone === true && (
        <div className="flex shrink-0 items-center pr-3">
          <Button size="sm" variant="outline" aria-label={`Close review ${name}`} onClick={() => onClose(r.id)}>Close</Button>
        </div>
      )}
    </li>
  );
}
