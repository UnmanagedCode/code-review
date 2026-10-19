import { Button } from '@/components/ui/button';
import type { Thread } from '@/lib/types';
import { useReviewActions } from '@/state/threads';
import { useBusy } from './useBusy';

/** Rendered inside the reply form, so every button is `type="button"`: a submit would post the draft. */
export function ResolveControls({ thread }: { thread: Thread }) {
  const actions = useReviewActions();
  const [busy, run] = useBusy();
  if (thread.status === 'outdated') return null;
  if (thread.status === 'resolved') {
    return <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => run(() => actions.setStatus(thread.id, 'open'))}>Reopen</Button>;
  }
  if (thread.kind === 'finding') {
    return (
      <span className="flex min-w-0 flex-wrap justify-end gap-2">
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => run(() => actions.setStatus(thread.id, 'resolved', 'fixed'))}>Resolve as fixed</Button>
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => run(() => actions.setStatus(thread.id, 'resolved', 'dismissed'))}>Resolve as dismissed</Button>
      </span>
    );
  }
  return <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => run(() => actions.setStatus(thread.id, 'resolved'))}>Resolve</Button>;
}
