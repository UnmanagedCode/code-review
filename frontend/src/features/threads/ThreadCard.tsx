import { useEffect, useRef } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { formatLines, navigate, useRoute } from '@/lib/route';
import type { Thread } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useReviewCtx } from '@/state/reviewContext';
import { useReviewActions } from '@/state/threads';
import { AuthorBadge } from './AuthorBadge';
import { KindBadge } from './KindBadge';
import { MessageBody } from './MessageBody';
import { ReplyBox } from './ReplyBox';
import { ResolveControls } from './ResolveControls';

const place = (t: Thread) => `L${formatLines(t.anchor.startLine, t.anchor.endLine).replace('-', '–L')} (${t.anchor.side})`;

/** One thread. `dropped`: a session-local tombstone of an uncommitted thread whose lines changed. */
export function ThreadCard({ thread, dropped = false, showLocation = false }: { thread: Thread; dropped?: boolean; showLocation?: boolean }) {
  const { readOnly, round } = useReviewCtx();
  const actions = useReviewActions();
  const route = useRoute();
  const ref = useRef<HTMLElement>(null);
  const focused = route.thread === thread.id;
  const marked = useRef(false);
  useEffect(() => {
    if (!focused) { marked.current = false; return; }
    ref.current?.scrollIntoView?.({ block: 'center' });
    if (thread.unread > 0 && !marked.current && !dropped) { marked.current = true; void actions.markRead(thread.id); }
  }, [focused, thread.unread, dropped]);

  const outdated = thread.status === 'outdated';
  return (
    <article
      ref={ref}
      aria-label={`${thread.kind} thread`}
      className={cn('flex flex-col gap-2 rounded-md border bg-card p-3 text-card-foreground', focused && 'ring-2 ring-ring', dropped && 'opacity-70')}
    >
      <header className="flex flex-wrap items-center gap-1.5">
        <KindBadge kind={thread.kind} severity={thread.severity} />
        <Badge variant={thread.status === 'open' ? 'warning' : 'secondary'}>{thread.status}</Badge>
        {thread.disposition && <Badge variant="success">{thread.disposition}</Badge>}
        {thread.anchor.drifted && <Badge variant="info" title="Found again by its surrounding context">re-anchored by context</Badge>}
        {thread.unread > 0 && <Badge variant="default">{thread.unread} unread</Badge>}
        {showLocation && !dropped && (
          <Button variant="link" size="sm" className="h-auto p-0 font-mono text-xs"
            onClick={() => navigate({ file: thread.anchor.file, side: thread.anchor.side, lines: formatLines(thread.anchor.startLine, thread.anchor.endLine), thread: thread.id })}>
            {thread.anchor.file}:{thread.anchor.startLine}
          </Button>
        )}
        {!dropped && !focused && <Button variant="ghost" size="sm" className="ml-auto h-6 px-2 text-xs" onClick={() => navigate({ thread: thread.id })}>Focus</Button>}
      </header>
      {dropped && <p className="text-xs text-muted-foreground">dropped: its lines changed</p>}
      {outdated && <p className="text-xs text-muted-foreground">outdated · was {place(thread)} at round {thread.anchor.round}</p>}
      {thread.positionUnknown && (
        <p className="text-xs text-muted-foreground">position in round {round} unknown · first recorded at {place(thread)} in round {thread.anchor.round}</p>
      )}
      {thread.resolveProposed && thread.status === 'open' && (
        <Alert variant="info"><AlertDescription>An agent proposes resolving this thread.</AlertDescription></Alert>
      )}
      <ol className="flex flex-col gap-2">
        {thread.messages.map((m) => (
          <li key={m.id} className="flex flex-col gap-1">
            <span className="flex flex-wrap items-center gap-1.5">
              <AuthorBadge author={m.author} />
              {m.proposeResolve && <Badge variant="success">proposes resolution</Badge>}
            </span>
            <MessageBody message={m} />
          </li>
        ))}
      </ol>
      {!!thread.laterMessages && (
        <p className="text-xs text-muted-foreground">
          {thread.laterMessages} later {thread.laterMessages === 1 ? 'reply' : 'replies'} — see the current round
        </p>
      )}
      {!readOnly && (
        <>
          <ReplyBox threadId={thread.id} />
          {!dropped && <div className="flex justify-end"><ResolveControls thread={thread} /></div>}
        </>
      )}
    </article>
  );
}
