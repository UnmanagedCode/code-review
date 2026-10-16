import { ArrowLeftIcon, MoreHorizontalIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { RouteLink } from '@/components/RouteLink';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { getBridge } from '@/lib/bridge';
import { bridgeMessage } from '@/lib/refusals';
import { REVIEW_SCOPED } from '@/lib/route';
import { useReviewAdmin } from '@/state/admin';
import { useReviewCtx } from '@/state/reviewContext';
import { useReviewActions } from '@/state/threads';
import { SubmitControls } from '@/features/submit/SubmitControls';
import { RecipientPicker } from './RecipientPicker';

const CLEAR = { review: undefined, ...REVIEW_SCOPED };

export function ReviewHeader() {
  const { review, rounds, sessions, round: pastRound } = useReviewCtx();
  // A past-round view is read-only: no review-level writes either, since they would act on the current round.
  const writable = pastRound === undefined;
  const admin = useReviewAdmin();
  const actions = useReviewActions();
  const [picker, setPicker] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const round = rounds.find((r) => r.n === review.round);
  const recipient = sessions.find((s) => s.sessionId === review.recipient);
  const recipientLabel = recipient?.title || review.recipient || 'none';
  const author = review.author ? sessions.find((s) => s.sessionId === review.author) : undefined;
  const bridge = getBridge();
  const canOpenAgent = !!bridge && !!review.recipient;

  const openAgent = async () => {
    const res = await bridge!.openSession(review.recipient!);
    if (!res.ok) toast.error(bridgeMessage(res.code));
  };

  return (
    <header className="flex flex-col gap-2 border-b p-3">
      <RouteLink to={CLEAR} className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeftIcon className="size-4" />Reviews</RouteLink>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="min-w-0 flex-1 truncate text-base font-semibold">{review.title || review.label}</h1>
        <Badge variant="outline">{review.kind}</Badge>
        <Badge variant={review.status === 'open' ? 'success' : 'secondary'}>{review.status}</Badge>
        {!review.seenByHuman && <Badge variant="info">new</Badge>}
      </div>
      <p className="text-xs text-muted-foreground">
        Round {review.round} · {round?.submittedAt ? 'submitted' : 'not yet submitted'}
        {review.title ? ` · ${review.label}` : ''}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {writable ? (
          <button type="button" className="rounded-md border px-2 py-1 text-xs hover:bg-accent" onClick={() => setPicker(true)}>
            Recipient: {recipientLabel}
          </button>
        ) : <span className="px-2 py-1 text-xs">Recipient: {recipientLabel}</span>}
        {review.author && <span className="text-xs text-muted-foreground">Author: {author?.title || review.author}</span>}
        <span className="flex-1" />
        {(writable || canOpenAgent) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="outline" size="icon" aria-label="Review actions"><MoreHorizontalIcon /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {writable && <DropdownMenuItem onSelect={() => admin.patch({ status: review.status === 'open' ? 'closed' : 'open' })}>{review.status === 'open' ? 'Close review' : 'Reopen review'}</DropdownMenuItem>}
              {writable && <DropdownMenuItem onSelect={() => actions.markRead()}>Mark all read</DropdownMenuItem>}
              {canOpenAgent && <DropdownMenuItem onSelect={openAgent}>Open agent</DropdownMenuItem>}
              {writable && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>Delete review…</DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {writable && <SubmitControls onNoRecipient={() => setPicker(true)} />}
      </div>
      {writable && confirmDelete && (
        <div role="alertdialog" aria-label="Confirm delete" className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/30 p-2 text-sm">
          <span className="flex-1">Delete this review and all its threads?</span>
          <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>Keep</Button>
          <Button size="sm" variant="destructive" onClick={admin.remove}>Delete</Button>
        </div>
      )}
      {writable && picker && <RecipientPicker onClose={() => setPicker(false)} />}
    </header>
  );
}
