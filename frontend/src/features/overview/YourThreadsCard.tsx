import { byPlace } from '@/lib/threadState';
import type { ThreadState } from '@/lib/types';
import { useReviewCtx } from '@/state/reviewContext';
import { Card } from './Card';
import { ThreadRow } from './ThreadRow';

/** Open threads where the human acted last: the ones the next round will send, and the ones the agent has. */
export function YourThreadsCard() {
  const { openThreads, files, guide } = useReviewCtx();
  const group = (state: ThreadState) => byPlace(openThreads.filter((t) => t.state === state), files, guide);
  const sections = [
    { title: 'Will be sent', rows: group('unsent'), note: 'Sent with the next Submit round' },
    { title: 'Waiting on agent', rows: group('awaiting-agent'), note: null },
  ].filter((s) => s.rows.length);
  return (
    <Card title="Your threads">
      {sections.length ? sections.map((s) => (
        <div key={s.title} className="flex flex-col gap-1">
          <h4 className="text-xs font-semibold">{s.title} <span className="font-normal text-muted-foreground">({s.rows.length})</span></h4>
          {s.note && <p className="text-xs text-muted-foreground">{s.note}</p>}
          <ul className="flex flex-col">{s.rows.map((t) => <ThreadRow key={t.id} thread={t} which="first" />)}</ul>
        </div>
      )) : <p className="text-sm text-muted-foreground">No threads of yours are open</p>}
    </Card>
  );
}
