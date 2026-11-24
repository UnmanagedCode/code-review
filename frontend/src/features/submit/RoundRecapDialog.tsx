import { ChevronDownIcon, ChevronRightIcon, SendIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { getBridge } from '@/lib/bridge';
import { errorText } from '@/lib/refusals';
import { navigate, type Route } from '@/lib/route';
import { useReviewCtx } from '@/state/reviewContext';
import { clearDraft, useDraft } from '@/state/drafts';
import { useRoundRecap } from '@/state/recap';
import type { useSubmission } from '@/state/submit';
import { Spinner } from '@/features/common/States';
import { RecapSummary } from './RecapSummary';

/** The step before every round send: who gets it, what it carries, an optional overall note, and the prompt on demand. Never blocks on undecided hunks. */
export function RoundRecapDialog({ sub, onNoRecipient }: { sub: ReturnType<typeof useSubmission>; onNoRecipient: () => void }) {
  const ctx = useReviewCtx();
  const { review } = ctx;
  const draftKey = `round-note:${ctx.id}`;
  const [note, setNote] = useDraft(draftKey, '');
  const [previewOpen, setPreviewOpen] = useState(false);
  const { phase } = sub.state;
  const open = phase === 'recap' || ((phase === 'composing' || phase === 'sending') && !!sub.state.viaRecap);
  const busy = phase === 'composing' || phase === 'sending';
  const { recap, error, loading, text } = useRoundRecap(ctx.id, open, open && previewOpen, note, review.rev);
  const recipient = ctx.sessions.find((s) => s.sessionId === review.recipient);
  const label = recipient?.label || review.recipient || 'the session';
  const bridge = !!getBridge();
  const uncommitted = review.kind === 'uncommitted';
  const refusal = (error as { code?: string } | undefined)?.code;

  useEffect(() => { if (!open) setPreviewOpen(false); }, [open]);
  useEffect(() => {
    if (open && refusal === 'NO_RECIPIENT') { sub.close(); onNoRecipient(); }
  }, [open, refusal]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = (route: Route) => { sub.close(); navigate(route); };
  const change = () => { sub.close(); onNoRecipient(); };
  const send = async () => { if (await sub.send(note)) clearDraft(draftKey); };
  const blocked = !!recap?.nothingToSubmit && !note.trim();

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && sub.close()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl [&>*]:min-w-0">
        <DialogHeader>
          <DialogTitle>{uncommitted ? 'Request review' : `Send round ${recap?.round ?? review.round}`}</DialogTitle>
          <DialogDescription>Check what goes out before it is sent.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="text-muted-foreground">To</span>
          <span className="inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-medium">
            {recipient?.live && <span aria-hidden className="size-2 rounded-full bg-success" />}
            {recipient ? `${label} · ${recipient.status}` : label}
          </span>
          <span className="text-xs text-muted-foreground">{bridge ? 'direct through code-conductor' : 'no cc connection: you’ll copy the prompt'}</span>
          <Button variant="link" size="sm" className="ml-auto h-auto p-0 text-xs" onClick={change}>Change recipient</Button>
        </div>
        {error !== undefined && refusal !== 'NO_RECIPIENT' && <Alert variant="destructive"><AlertDescription>{errorText(error)}</AlertDescription></Alert>}
        {recap ? <RecapSummary recap={recap} onGo={go} /> : loading && <Skeleton className="h-24" />}
        {blocked && <p className="px-2 text-sm text-muted-foreground">Nothing new since round {recap!.round} was sent. Add a note to send one.</p>}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="round-note">Overall note</Label>
          <Textarea id="round-note" rows={3} className="max-h-40 overflow-y-auto" value={note} onChange={(e) => setNote(e.target.value)} aria-describedby="round-note-hint" />
          <p id="round-note-hint" className="text-xs text-muted-foreground">optional, kept in the review as a review thread</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <button type="button" aria-expanded={previewOpen} aria-controls="round-preview" onClick={() => setPreviewOpen((v) => !v)}
            className="flex w-fit items-start gap-1 text-left text-sm font-medium">
            {previewOpen ? <ChevronDownIcon className="mt-0.5 size-4 shrink-0" /> : <ChevronRightIcon className="mt-0.5 size-4 shrink-0" />}
            Preview the prompt (what the agent receives)
          </button>
          {previewOpen && (
            <div id="round-preview">
              {text === undefined ? <Skeleton className="h-24" /> : (
                <pre aria-label="Prompt preview" className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/40 p-2 font-mono text-xs">{text}</pre>
              )}
            </div>
          )}
        </div>
        <DialogFooter className="sm:flex-nowrap sm:items-center">
          <p className="min-w-0 text-xs text-muted-foreground sm:mr-auto sm:flex-1">Delivery shows up in the review header; a failed send keeps Retry and Copy prompt.</p>
          <Button variant="ghost" className="shrink-0" disabled={busy} onClick={sub.close}>Cancel</Button>
          <Button disabled={busy || blocked} onClick={send} className="min-w-0 max-w-full sm:max-w-[18rem]" title={label}>
            {busy ? <Spinner /> : <SendIcon />}
            {bridge ? <><span className="shrink-0">Send to </span><span className="truncate">{label}</span></> : 'Compose prompt'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
