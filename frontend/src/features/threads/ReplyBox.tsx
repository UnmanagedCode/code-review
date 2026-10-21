import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { clearDraft, useDraft } from '@/state/drafts';
import { useReviewCtx } from '@/state/reviewContext';
import { useReviewActions } from '@/state/threads';
import { Spinner } from '@/features/common/States';
import { useBusy } from './useBusy';

/** `actions`: the thread's status controls, rendered in Reply's row before it. The unsent text lives in the draft store. */
export function ReplyBox({ threadId, actions: controls }: { threadId: string; actions?: ReactNode }) {
  const key = `reply:${useReviewCtx().id}:${threadId}`;
  const [body, setBody] = useDraft(key, '');
  const [busy, run] = useBusy();
  const actions = useReviewActions();
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await run(() => actions.reply(threadId, body))) clearDraft(key);
      }}
    >
      <Textarea aria-label="Reply" rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Reply…" />
      <div role="group" aria-label="Thread actions" className="flex items-start justify-end gap-2">
        {controls}
        <Button type="submit" size="sm" disabled={busy || !body.trim()}>{busy && <Spinner />}Reply</Button>
      </div>
    </form>
  );
}
