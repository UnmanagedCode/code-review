import type { ReactNode } from 'react';
import { RouteLink } from '@/components/RouteLink';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ageLabel } from '@/lib/age';
import { needsYouOf } from '@/lib/inbox';
import { REVIEW_SCOPED } from '@/lib/route';
import { shortPlace } from '@/lib/threadState';
import { cn } from '@/lib/utils';
import type { InboxItem, InboxReason } from '@/lib/types';

/** What the agent last did, in a sentence; null when it never acted. */
export function agentActionText(a: InboxItem['lastAgentAction']): string | null {
  if (!a) return null;
  if (a.kind === 'update') return 'Agent updated the review';
  const place = shortPlace(a.thread.anchor);
  switch (a.event) {
    case 'opened': return `Agent opened a thread on ${place}`;
    case 'proposed-resolution': return `Agent says ${place} is fixed`;
    case 'resolved': return `Agent resolved ${place}`;
    default: return `Agent replied on ${place}`;
  }
}

/** "sent 3 h ago", or "sent just now". */
const sentLabel = (at: string, now: number): string => {
  const age = ageLabel(at, now);
  return age === 'just now' ? 'sent just now' : `sent ${age} ago`;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The chip for one reason code; null when another chip already says it (unsent threads show as "will be sent"). */
function reasonChip(code: InboxReason, r: InboxItem): ReactNode {
  switch (code) {
    case 'threads': return <Badge key={code} variant="default">{needsYouOf(r)} need you</Badge>;
    case 'send-failed': return <Badge key={code} variant="warning">send failed</Badge>;
    case 'send-pending': return <Badge key={code} variant="warning">send unconfirmed</Badge>;
    case 'hunks': return <Badge key={code} variant="outline">{plural(r.hunks?.pending ?? 0, 'hunk')} undecided</Badge>;
    case 'groups': return <Badge key={code} variant="outline">{plural(r.groupsPending, 'group')} to decide</Badge>;
    case 'not-opened': return <Badge key={code} variant="info">not opened</Badge>;
    case 'unsent': return r.threadStates.unsent > 0 ? null : <Badge key={code} variant="outline">unsent changes</Badge>;
    case 'never-sent': return <Badge key={code} variant="outline">never sent</Badge>;
  }
}

/** One open review: a link into it, and a Close button beside it once cc no longer lists its checkout. */
export function InboxRow({ item: r, accent, onClose }: { item: InboxItem; accent?: boolean; onClose: (id: string) => void }) {
  const name = r.title || r.label;
  const now = Date.now();
  const gone = r.checkoutGone === true;
  const activity = agentActionText(r.lastAgentAction) ?? (r.turn === 'agent' ? 'No reply yet' : null);
  return (
    <li className={cn('flex items-stretch border-b', accent && 'border-l-2 border-l-primary')}>
      <RouteLink
        to={{ project: r.project, worktree: r.worktree ?? undefined, review: r.id, ...REVIEW_SCOPED }}
        className="flex min-w-0 flex-1 flex-col gap-1 px-3 py-2 hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
      >
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-medium" title={name}>{name}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{ageLabel(r.lastActivityAt, now)}</span>
        </span>
        <span className="truncate text-xs text-muted-foreground">{r.project} · {r.worktree ?? 'main checkout'} · {r.kind} · round {r.round}</span>
        <span className="flex flex-wrap items-center gap-1">
          {r.reasons.map((code) => reasonChip(code, r))}
          {r.threadStates.unsent > 0 && <Badge variant="info">{r.threadStates.unsent} will be sent</Badge>}
          {r.newActivity && <Badge variant="info">new activity</Badge>}
          {r.turn === 'agent' && r.lastSubmission && <Badge variant="secondary">{sentLabel(r.lastSubmission.at, now)}</Badge>}
          {r.staleReasons.includes('checkout-gone') && <Badge variant="warning">checkout gone</Badge>}
          {r.staleReasons.includes('idle') && <Badge variant="secondary">idle {ageLabel(r.lastActivityAt, now)}</Badge>}
        </span>
        {activity && <span className="truncate text-xs text-muted-foreground">{activity}</span>}
      </RouteLink>
      {gone && (
        <div className="flex shrink-0 items-center pr-3">
          <Button size="sm" variant="outline" aria-label={`Close review ${name}`} onClick={() => onClose(r.id)}>Close</Button>
        </div>
      )}
    </li>
  );
}
