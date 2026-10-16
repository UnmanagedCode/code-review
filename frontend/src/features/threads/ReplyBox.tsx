import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useReviewActions } from '@/state/threads';
import { Spinner } from '@/features/common/States';
import { useBusy } from './useBusy';

export function ReplyBox({ threadId }: { threadId: string }) {
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
      <Button type="submit" size="sm" className="self-end" disabled={busy || !body.trim()}>{busy && <Spinner />}Reply</Button>
    </form>
  );
}
