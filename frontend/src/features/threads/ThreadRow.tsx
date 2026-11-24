import { Badge } from '@/components/ui/badge';
import { ageLabel } from '@/lib/age';
import { navigate } from '@/lib/route';
import { placeLabel, shortPlace, STATE_LABEL } from '@/lib/threadState';
import type { GuideView, Thread, ThreadDigest } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useReviewActions } from '@/state/threads';
import { KindBadge } from './KindBadge';
import { threadPlace } from './ThreadCard';
import { ThreadStateChip } from './ThreadStateChip';

/** What a list row needs of a thread: a `ThreadDigest` (open threads) has all of it, `rowOf` maps a full `Thread` to it. */
export type ThreadRowModel = Pick<ThreadDigest, 'id' | 'kind' | 'severity' | 'state' | 'anchor' | 'unread'> & {
  status: Thread['status'];
  last: { at: string; preview: string };
};

/** A full thread as a row: the last message's raw body is the preview (the row's CSS clips it to a line). */
export function rowOf(t: Thread): ThreadRowModel {
  const last = t.messages[t.messages.length - 1];
  return { id: t.id, kind: t.kind, severity: t.severity, state: t.state, status: t.status, anchor: t.anchor, unread: t.unread, last: { at: last.at, preview: last.body } };
}

/**
 * One thread in a list, two lines: its state (or status, once it has no state), place, kind and age; then a one-line preview with
 * an unread dot. The whole row is a button that opens the thread in place. `now` pins the age for tests.
 */
export function ThreadRow({ row, guide, now = Date.now() }: { row: ThreadRowModel; guide: GuideView | null; now?: number }) {
  const place = shortPlace(row.anchor, guide);
  const label = row.state ? STATE_LABEL[row.state] : row.status;
  const actions = useReviewActions();
  const open = () => {
    // An outdated thread opens a comparison whose panel replaces this list, so no card is left to mark it read.
    if (row.status === 'outdated' && row.unread > 0) void actions.markRead(row.id);
    navigate(threadPlace(row));
  };
  return (
    <button
      type="button"
      aria-label={`${label}: ${place} — ${row.last.preview}`}
      title={placeLabel(row.anchor, guide)}
      className="flex w-full min-w-0 flex-col gap-0.5 rounded-md border bg-card px-2.5 py-1.5 text-left text-card-foreground hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
      onClick={open}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        {row.state ? <ThreadStateChip state={row.state} /> : <Badge variant="secondary">{row.status}</Badge>}
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">{place}</span>
        <KindBadge kind={row.kind} severity={row.severity} />
        <span className="shrink-0 text-xs text-muted-foreground">{ageLabel(row.last.at, now)}</span>
      </span>
      <span className="flex items-center gap-1.5">
        <span className={cn('line-clamp-1 min-w-0 flex-1 text-sm', row.unread === 0 && 'text-muted-foreground')}>{row.last.preview}</span>
        {row.unread > 0 && <span role="img" aria-label={`${row.unread} unread`} className="size-2 shrink-0 rounded-full bg-info" />}
      </span>
    </button>
  );
}
