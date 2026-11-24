import { ChevronRightIcon } from 'lucide-react';
import { RouteLink } from '@/components/RouteLink';
import { KindBadge } from '@/features/threads/KindBadge';
import { threadPlace } from '@/features/threads/ThreadCard';
import { ThreadStateChip } from '@/features/threads/ThreadStateChip';
import { ago } from '@/lib/relativeTime';
import { placeLabel } from '@/lib/threadState';
import type { Author, ThreadDigest } from '@/lib/types';
import { useReviewCtx } from '@/state/reviewContext';

/** Who wrote a message, as the overview names them: `You`, or the session's label. */
export function useAuthorName(): (a: Author) => string {
  const { sessions } = useReviewCtx();
  return (a) => (a.kind === 'human' ? 'You' : sessions.find((s) => s.sessionId === a.sessionId)?.label || a.sessionId.slice(0, 8));
}

/**
 * One open thread: its place, kind, and a one-line preview, linking to it in place. `which` picks the message previewed: the
 * newest (what needs a reply) or the first (what you asked). `withState` adds the state chip.
 */
export function ThreadRow({ thread, which, withState = false }: { thread: ThreadDigest; which: 'last' | 'first'; withState?: boolean }) {
  const { guide } = useReviewCtx();
  const name = useAuthorName();
  const m = thread[which];
  return (
    <li>
      <RouteLink to={threadPlace(thread)} className="flex min-w-0 items-start gap-2 rounded-md p-1.5 hover:bg-accent">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-1.5">
            {withState && thread.state && <ThreadStateChip state={thread.state} />}
            <KindBadge kind={thread.kind} severity={thread.severity} />
            <span className="min-w-0 break-all font-mono text-xs text-muted-foreground">{placeLabel(thread.anchor, guide)}</span>
          </span>
          <span className="break-words text-sm"><span className="text-muted-foreground">{name(m.author)}: </span>{m.preview}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">{ago(m.at)}<ChevronRightIcon className="size-4" aria-hidden /></span>
      </RouteLink>
    </li>
  );
}
