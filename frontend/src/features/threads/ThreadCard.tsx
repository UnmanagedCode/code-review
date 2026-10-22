import { useEffect, useRef, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { formatLines, navigate, useRoute, type Route } from '@/lib/route';
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

/**
 * The route that shows `t` in place. An outdated thread's anchor is its last located one, so round `anchor.round` still holds
 * it and it went outdated in the next: that comparison puts it on the left at its old lines. A base-side anchor has no place
 * in a comparison, so it opens that round's own view. `commit` is cleared because it beats `compare`.
 */
const at = (t: Thread): Route => {
  const { file, side, startLine, endLine, round } = t.anchor;
  const lines = formatLines(startLine, endLine);
  if (t.status !== 'outdated') return { file, side, lines, thread: t.id };
  if (side === 'old') return { round: String(round), compare: undefined, commit: undefined, file, side, lines, thread: t.id };
  return { compare: `${round}..${round + 1}`, round: undefined, commit: undefined, file, side: 'old', lines, thread: t.id };
};

/** One thread. `dropped`: a session-local tombstone of an uncommitted thread whose lines changed. `note`: shown under the header. */
export function ThreadCard({ thread, dropped = false, showLocation = false, note }: { thread: Thread; dropped?: boolean; showLocation?: boolean; note?: ReactNode }) {
  const { readOnly, compare } = useReviewCtx();
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
  const jump = () => {
    if (outdated && thread.unread > 0) void actions.markRead(thread.id); // this card unmounts before the focus effect can
    navigate(at(thread));
  };
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
            onClick={jump}>
            {thread.anchor.file}:{thread.anchor.startLine}
          </Button>
        )}
        {!dropped && !focused && <Button variant="ghost" size="sm" className="ml-auto h-6 px-2 text-xs" onClick={() => (outdated || thread.anchor.file !== route.file ? jump() : navigate({ thread: thread.id }))}>Focus</Button>}
      </header>
      {note}
      {dropped && <p className="text-xs text-muted-foreground">dropped: its lines changed</p>}
      {outdated && <p className="text-xs text-muted-foreground">outdated · was {place(thread)} at round {thread.anchor.round}</p>}
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
            <MessageBody message={m} atItsRound={!!compare} />
          </li>
        ))}
      </ol>
      {!!thread.laterMessages && (
        <p className="text-xs text-muted-foreground">
          {thread.laterMessages} later {thread.laterMessages === 1 ? 'reply' : 'replies'} — see the current round
        </p>
      )}
      {!readOnly && <ReplyBox threadId={thread.id} actions={!dropped && <ResolveControls thread={thread} />} />}
    </article>
  );
}
