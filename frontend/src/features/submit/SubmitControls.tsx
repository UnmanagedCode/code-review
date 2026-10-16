import { SendIcon } from 'lucide-react';
import { useRef } from 'react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { getBridge } from '@/lib/bridge';
import { bridgeMessage, isBridgeCode } from '@/lib/refusals';
import type { Submission } from '@/lib/types';
import { useReviewCtx } from '@/state/reviewContext';
import { useSubmission } from '@/state/submit';
import { Spinner } from '@/features/common/States';

/** "Submit round" / "Request review", its delivery dialog, and the re-send banner for a submission left undelivered. */
export function SubmitControls({ onNoRecipient }: { onNoRecipient: () => void }) {
  const ctx = useReviewCtx();
  const { review } = ctx;
  const recipient = ctx.sessions.find((s) => s.sessionId === review.recipient);
  const sub = useSubmission({ reviewId: ctx.id, recipientLabel: recipient?.title || review.recipient || 'the session', onRecorded: ctx.reload, onNoRecipient });
  const textRef = useRef<HTMLTextAreaElement>(null);
  const uncommitted = review.kind === 'uncommitted';
  const busy = sub.state.phase === 'composing' || sub.state.phase === 'sending';
  const disabledReason = review.status === 'closed' ? 'The review is closed' : null;

  const last = review.lastSubmission;
  const pending = last && (last.status === 'failed' || last.status === 'pending') && sub.state.phase === 'idle'
    ? ctx.submissions.find((x) => String(x.id) === String(last.id)) : undefined;

  const dialogState = sub.state.phase === 'manual' || sub.state.phase === 'failed' || sub.state.phase === 'timedOut' ? sub.state : null;
  const submission: Submission | undefined = dialogState?.submission;

  async function copy() {
    if (!submission) return;
    try {
      await navigator.clipboard.writeText(submission.text);
      toast.success('Prompt copied');
    } catch {
      textRef.current?.select();
      toast.info('Press Ctrl/Cmd+C to copy');
    }
  }
  const openAgent = async () => {
    const res = await getBridge()?.openSession(submission!.recipient);
    if (res && !res.ok) toast.error(bridgeMessage(res.code));
  };

  return (
    <>
      <Button disabled={busy || !!disabledReason} title={disabledReason ?? undefined} onClick={() => (review.recipient ? sub.start() : onNoRecipient())}>
        {busy ? <Spinner /> : <SendIcon />}{uncommitted ? 'Request review' : 'Submit round'}
      </Button>
      {pending && (
        <Alert variant="warning" className="basis-full">
          <AlertDescription>
            <p>{last!.status === 'failed' ? `Last submission failed (${last!.code ?? 'unknown'})` : 'Last submission isn’t recorded as delivered'}</p>
            {last!.status === 'pending' && <p id="resend-warning">It may already have reached the session, so re-sending could deliver it twice.</p>}
            <Button size="sm" variant="outline" onClick={() => sub.resend(pending)} aria-describedby={last!.status === 'pending' ? 'resend-warning' : undefined}>Re-send</Button>
          </AlertDescription>
        </Alert>
      )}
      <Dialog open={!!dialogState} onOpenChange={(o) => !o && sub.close()}>
        <DialogContent className="[&>*]:min-w-0">
          <DialogHeader>
            <DialogTitle>{uncommitted ? 'Request review' : 'Submit round'}</DialogTitle>
            <DialogDescription>
              {dialogState?.phase === 'manual' && 'No cc connection here: copy this prompt into the recipient session.'}
              {dialogState?.phase === 'failed' && 'The prompt was not delivered.'}
              {dialogState?.phase === 'timedOut' && 'cc didn’t answer — the prompt may not have arrived.'}
            </DialogDescription>
          </DialogHeader>
          {dialogState?.phase === 'failed' && (
            <Alert variant="destructive"><AlertDescription>{bridgeMessage(dialogState.code)}{!isBridgeCode(dialogState.code) && ' (not recorded)'}</AlertDescription></Alert>
          )}
          {dialogState?.phase === 'timedOut' && (
            <Alert variant="warning"><AlertDescription id="retry-warning">The prompt may already have arrived, so retrying could deliver it twice.</AlertDescription></Alert>
          )}
          <Textarea ref={textRef} readOnly rows={10} aria-label="Prompt" value={submission?.text ?? ''} className="font-mono text-xs" />
          <DialogFooter className="sm:flex-wrap">
            {dialogState?.phase === 'manual' ? (
              <Button variant="ghost" onClick={sub.close}>Close</Button>
            ) : (
              <>
                <Button variant="ghost" onClick={sub.close}>Close</Button>
                <Button variant="outline" onClick={() => submission && sub.resend(submission)} aria-describedby={dialogState?.phase === 'timedOut' ? 'retry-warning' : undefined}>
                  {dialogState?.phase === 'timedOut' ? 'Retry anyway' : 'Retry'}
                </Button>
                {getBridge() && <Button variant="outline" onClick={openAgent}>Open agent</Button>}
              </>
            )}
            <Button variant="outline" onClick={copy}>{dialogState?.phase === 'manual' ? 'Copy' : 'Copy prompt'}</Button>
            <Button onClick={sub.markSent}>Mark as sent</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
