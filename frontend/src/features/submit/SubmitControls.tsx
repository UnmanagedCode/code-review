import { SendIcon } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import * as ep from '@/lib/endpoints';
import { useReviewCtx } from '@/state/reviewContext';
import { useSubmission } from '@/state/submit';
import { Spinner } from '@/features/common/States';
import { SubmissionDialog } from './SubmissionDialog';

/** "Submit round" / "Request review", its delivery dialog, and the re-send banner for a submission left undelivered. */
export function SubmitControls({ onNoRecipient }: { onNoRecipient: () => void }) {
  const ctx = useReviewCtx();
  const { review } = ctx;
  const recipient = ctx.sessions.find((s) => s.sessionId === review.recipient);
  const sub = useSubmission({ reviewId: ctx.id, compose: () => ep.compose(ctx.id), recipientLabel: recipient?.label || review.recipient || 'the session', onRecorded: ctx.reload, onNoRecipient });
  const uncommitted = review.kind === 'uncommitted';
  const busy = sub.state.phase === 'composing' || sub.state.phase === 'sending';
  const disabledReason = review.status === 'closed' ? 'The review is closed' : null;

  const last = review.lastSubmission;
  const pending = last && (last.status === 'failed' || last.status === 'pending') && sub.state.phase === 'idle'
    ? ctx.submissions.find((x) => String(x.id) === String(last.id)) : undefined;
  const what = last?.kind === 'guide' ? 'Guide me request' : 'submission';

  return (
    <>
      <Button disabled={busy || !!disabledReason} title={disabledReason ?? undefined} onClick={() => (review.recipient ? sub.start() : onNoRecipient())}>
        {busy ? <Spinner /> : <SendIcon />}{uncommitted ? 'Request review' : 'Submit round'}
      </Button>
      {pending && (
        <Alert variant="warning" className="basis-full">
          <AlertDescription>
            <p>{last!.status === 'failed' ? `Last ${what} failed (${last!.code ?? 'unknown'})` : `Last ${what} isn’t recorded as delivered`}</p>
            {last!.status === 'pending' && <p id="resend-warning">It may already have reached the session, so re-sending could deliver it twice.</p>}
            <Button size="sm" variant="outline" onClick={() => sub.resend(pending)} aria-describedby={last!.status === 'pending' ? 'resend-warning' : undefined}>Re-send</Button>
          </AlertDescription>
        </Alert>
      )}
      <SubmissionDialog sub={sub} title={uncommitted ? 'Request review' : 'Submit round'} />
    </>
  );
}
