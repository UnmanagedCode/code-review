import { SendIcon } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import * as ep from '@/lib/endpoints';
import { useShortcutHandler } from '@/state/shortcutRegistry';
import { useReviewCtx } from '@/state/reviewContext';
import { useInFlight, useSubmission } from '@/state/submit';
import { Spinner } from '@/features/common/States';
import { RoundRecapDialog } from './RoundRecapDialog';
import { SubmissionDialog } from './SubmissionDialog';

/** "Submit round" / "Request review", its recap and delivery dialogs, and the re-send banner for a submission left undelivered. */
export function SubmitControls({ onNoRecipient }: { onNoRecipient: () => void }) {
  const ctx = useReviewCtx();
  const { review } = ctx;
  const recipient = ctx.sessions.find((s) => s.sessionId === review.recipient);
  const sub = useSubmission({ reviewId: ctx.id, compose: (note) => ep.compose(ctx.id, note), recipientLabel: recipient?.label || review.recipient || 'the session', onRecorded: ctx.reload, onNoRecipient });
  const uncommitted = review.kind === 'uncommitted';
  const busy = sub.state.phase === 'composing' || sub.state.phase === 'sending';
  const disabledReason = review.status === 'closed' ? 'The review is closed' : null;

  const submit = () => (review.recipient ? sub.review() : onNoRecipient());
  // `s` is what the button does (the recap opens; nothing is sent); where the button is disabled the key is unregistered.
  useShortcutHandler('submit-round', busy || disabledReason ? null : submit);

  const last = review.lastSubmission;
  const delivering = useInFlight(last?.id);
  const pending = last && (last.status === 'failed' || last.status === 'pending') && sub.state.phase === 'idle' && !delivering
    ? ctx.submissions.find((x) => String(x.id) === String(last.id)) : undefined;
  const what = last?.kind === 'guide' ? 'Guide me request' : 'submission';

  return (
    <>
      <Button disabled={busy || !!disabledReason} title={disabledReason ?? undefined} onClick={submit}>
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
      <RoundRecapDialog sub={sub} onNoRecipient={onNoRecipient} />
      <SubmissionDialog sub={sub} title={uncommitted ? 'Request review' : 'Submit round'} />
    </>
  );
}
