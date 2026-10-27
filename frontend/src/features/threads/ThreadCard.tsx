import { useEffect, useRef, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { anchorLabel, lineSpan, rangeLabel } from '@/lib/ranges';
import { formatLines, navigate, useRoute, type Route } from '@/lib/route';
import type { ComparedThread, Thread } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useReviewCtx } from '@/state/reviewContext';
import { useReviewActions } from '@/state/threads';
import { AuthorBadge } from './AuthorBadge';
import { KindBadge } from './KindBadge';
import { MessageBody } from './MessageBody';
import { ReplyBox } from './ReplyBox';
import { ResolveControls } from './ResolveControls';

/**
 * The route that shows `t` in place. An outdated thread's anchor is its last located one, so round `anchor.round` still holds
 * it and it went outdated in the next: that comparison puts it on the left at its old lines. A base-side anchor has no place
 * in a comparison, so it opens that round's own view. `commit` is cleared because it beats `compare`. A live thread gets no
 * `lines=` (its range rail marks it; the wash is for citations) and a stale one is cleared; an outdated thread keeps
 * `lines=`, which the read-only excerpt needs when its file is not in that comparison.
 * A file thread has no side or lines: an outdated one opens the round it last sat in. A review thread lives in the Threads
 * pane, beside whatever file is open. `src/links.js` `threadLink` mirrors this.
 */
export const threadPlace = (t: Thread): Route => {
  if (t.anchor.kind === 'review') return { view: 'threads', thread: t.id };
  if (t.anchor.kind === 'file') {
    const { file, round } = t.anchor;
    const place = { file, side: undefined, lines: undefined, thread: t.id };
    return t.status === 'outdated' ? { ...place, round: String(round), compare: undefined, commit: undefined } : place;
  }
  const { file, side, startLine, endLine, round } = t.anchor;
  if (t.status !== 'outdated') return { file, side, lines: undefined, thread: t.id };
  const lines = formatLines(startLine, endLine);
  if (side === 'old') return { round: String(round), compare: undefined, commit: undefined, file, side, lines, thread: t.id };
  return { compare: `${round}..${round + 1}`, round: undefined, commit: undefined, file, side: 'old', lines, thread: t.id };
};

/**
 * The place a thread's card names (`L3–L5 (new)`, `Whole file`, `Review`), or null: an outdated card's "was …" line
 * names its last place, a dropped one has none, and in a comparison the note names each copy's place per round.
 */
export function cardRange(thread: Thread, { dropped = false, compare }: { dropped?: boolean; compare?: unknown }): string | null {
  return thread.status === 'outdated' || dropped || compare ? null : anchorLabel(thread.anchor);
}

/**
 * What a location link names: the file, then the anchor's range (an outdated thread's is its last located one), so two
 * links in one file never share a name; a file thread's names the whole file and a review thread's the review. In a
 * comparison a copy's side is a round's head, so it names the round.
 */
const linkText = (t: Thread, compare?: { from: number; to: number }): string => {
  const a = t.anchor;
  if (a.kind === 'review') return anchorLabel(a);
  const placement = (t as Partial<ComparedThread>).placement;
  if (!compare || !placement) return `${a.file} · ${anchorLabel(a)}`;
  const round = `round ${placement === 'from' ? compare.from : compare.to}`;
  return `${a.file} · ${a.kind === 'lines' ? `${round} ${lineSpan(a.startLine, a.endLine)}` : `${round} · ${anchorLabel(a)}`}`;
};

/** An outdated card's note on where the thread last sat. */
const wasAt = (t: Thread): string => (t.anchor.kind === 'lines'
  ? `outdated · was ${rangeLabel(t.anchor)} at round ${t.anchor.round}`
  : `outdated · its file left the diff after round ${t.anchor.round}`);

/** One thread. `unplaced`: a comparison has no place for it, so Focus never moves the file position. `dropped`: a session-local tombstone of an uncommitted thread whose lines changed. `note`: shown under the header. */
export function ThreadCard({ thread, dropped = false, showLocation = false, unplaced = false, note }: { thread: Thread; dropped?: boolean; showLocation?: boolean; unplaced?: boolean; note?: ReactNode }) {
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
    navigate(threadPlace(thread));
  };
  const range = cardRange(thread, { dropped, compare });
  // A review thread is shown in the pane, so Focus opens it there; a file-bound one opens its file unless that is open.
  const elsewhere = thread.anchor.kind === 'review' ? route.view !== 'threads' : thread.anchor.file !== route.file;
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
        {thread.anchor.kind === 'lines' && thread.anchor.drifted && <Badge variant="info" title="Found again by its surrounding context">re-anchored by context</Badge>}
        {thread.unread > 0 && <Badge variant="default">{thread.unread} unread</Badge>}
        {showLocation && !dropped ? (
          <Button variant="link" size="sm" className="h-auto p-0 font-mono text-xs"
            onClick={jump}>
            {linkText(thread, compare)}
          </Button>
        ) : range && <span className="font-mono text-xs text-muted-foreground">{range}</span>}
        {!dropped && !focused && <Button variant="ghost" size="sm" className="ml-auto h-6 px-2 text-xs" onClick={() => (!unplaced && (outdated || elsewhere) ? jump() : navigate({ thread: thread.id }))}>Focus</Button>}
      </header>
      {note}
      {dropped && <p className="text-xs text-muted-foreground">dropped: {thread.anchor.kind === 'lines' ? 'its lines changed' : 'its file left the diff'}</p>}
      {outdated && <p className="text-xs text-muted-foreground">{wasAt(thread)}</p>}
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
