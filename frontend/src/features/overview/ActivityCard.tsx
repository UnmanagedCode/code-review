import { BotIcon } from 'lucide-react';
import { RouteLink } from '@/components/RouteLink';
import { threadPlace } from '@/features/threads/ThreadCard';
import { ago } from '@/lib/relativeTime';
import { placeLabel } from '@/lib/threadState';
import type { ActivityItem, Submission } from '@/lib/types';
import { useReviewCtx } from '@/state/reviewContext';
import { visitBaseline } from '@/state/lastViewed';
import { Card } from './Card';
import { useAuthorName } from './ThreadRow';

const VERB = (a: ActivityItem): string => ({
  opened: `opened a ${a.thread.kind} on`, replied: 'replied on', 'proposed-resolution': 'proposed resolving', resolved: 'resolved',
})[a.event];

/** What the round has been through: sent or not, and to whom. */
function useRoundStatus(): string {
  const { review, submissions, sessions } = useReviewCtx();
  const labelOf = (id: string | null) => (id ? sessions.find((s) => s.sessionId === id)?.label || id : null);
  const pending = labelOf(review.recipient);
  const sent: Submission | undefined = submissions.findLast((s) => s.kind === 'round' && s.status === 'delivered');
  if (review.unsent || !sent) return `Round ${review.round} not sent yet${pending ? ` to ${pending}` : ' · no recipient set'}`;
  // The delivered round went to the recipient it was composed for, which may not be the review's recipient now.
  const to = labelOf(sent.recipient);
  const at = sent.deliveredAt ? ` · ${ago(sent.deliveredAt)}` : '';
  return `Round ${sent.round} sent${to ? ` to ${to}${at}` : ` · no recipient set${at}`}`;
}

/** The agent's thread events newer than the marker this visit started from. */
export function ActivityCard() {
  const { review, activity, guide } = useReviewCtx();
  const name = useAuthorName();
  const baseline = visitBaseline(review);
  const items = activity.filter((a) => a.seq > baseline);
  const status = useRoundStatus();
  return (
    <Card title="What the agent did — since you last looked">
      {items.length ? (
        <ul className="flex flex-col">
          {items.map((a) => (
            <li key={a.seq}>
              <RouteLink to={threadPlace({ id: a.thread.id, status: 'open', anchor: a.thread.anchor })} className="flex items-start gap-2 rounded-md p-1.5 text-sm hover:bg-accent">
                <BotIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 break-words">
                  <strong className="font-medium">{name(a.actor)}</strong> {VERB(a)} <span className="break-all font-mono text-xs">{placeLabel(a.thread.anchor, guide)}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{ago(a.at)}</span>
              </RouteLink>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-muted-foreground">Nothing new since you last looked</p>}
      <p className="border-t pt-2 text-xs text-muted-foreground">{status}</p>
    </Card>
  );
}
