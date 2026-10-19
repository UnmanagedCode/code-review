import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useReviewActions } from '@/state/threads';
import { Spinner } from '@/features/common/States';
import { useBusy } from './useBusy';

/** `actions`: the thread's status controls, rendered in Reply's row before it. */
export function ReplyBox({ threadId, actions: controls }: { threadId: string; actions?: ReactNode }) {
  const [body, setBody] = useState('');
  const [busy, run] = useBusy();
  const actions = useReviewActions();
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await run(() => actions.reply(threadId, body))) setBody('');
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
