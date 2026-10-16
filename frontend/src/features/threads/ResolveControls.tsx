import { Button } from '@/components/ui/button';
import type { Thread } from '@/lib/types';
import { useReviewActions } from '@/state/threads';
import { useBusy } from './useBusy';

export function ResolveControls({ thread }: { thread: Thread }) {
  const actions = useReviewActions();
  const [busy, run] = useBusy();
  if (thread.status === 'outdated') return null;
  if (thread.status === 'resolved') {
    return <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => actions.setStatus(thread.id, 'open'))}>Reopen</Button>;
  }
  if (thread.kind === 'finding') {
    return (
      <span className="flex gap-2">
        <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => actions.setStatus(thread.id, 'resolved', 'fixed'))}>Resolve as fixed</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => actions.setStatus(thread.id, 'resolved', 'dismissed'))}>Resolve as dismissed</Button>
      </span>
    );
  }
  return <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => actions.setStatus(thread.id, 'resolved'))}>Resolve</Button>;
}
