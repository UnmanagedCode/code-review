import { NEEDS_YOU, byPlace } from '@/lib/threadState';
import { useReviewCtx } from '@/state/reviewContext';
import { Card } from './Card';
import { ThreadRow } from './ThreadRow';

/** Open threads where the human is the one to act, in place order. */
export function NeedsYouCard() {
  const { openThreads, files, guide } = useReviewCtx();
  const rows = byPlace(openThreads.filter((t) => t.state && NEEDS_YOU.includes(t.state)), files, guide);
  return (
    <Card title="Needs you" count={rows.length}>
      {rows.length
        ? <ul className="flex flex-col">{rows.map((t) => <ThreadRow key={t.id} thread={t} which="last" withState />)}</ul>
        : <p className="text-sm text-muted-foreground">Nothing needs you right now</p>}
    </Card>
  );
}
