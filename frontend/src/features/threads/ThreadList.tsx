import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useRoute } from '@/lib/route';
import { GROUP_LABEL, stateGroup, type StateGroup } from '@/lib/threadState';
import type { Thread } from '@/lib/types';
import { useReviewCtx } from '@/state/reviewContext';
import { Loading } from '@/features/common/States';
import { ThreadCard } from './ThreadCard';
import { ThreadRow, type ThreadRowModel } from './ThreadRow';

/**
 * Compact rows, except the routed thread, which opens as its full card (reply, resolve, the read mark). `full` finds the
 * whole thread behind a row; until it is loaded (the routed file's diff, say) the row shows a loading line.
 */
export function ThreadList({ rows, full }: { rows: ThreadRowModel[]; full: (id: string) => Thread | undefined }) {
  const { guide } = useReviewCtx();
  const routed = useRoute().thread;
  return (
    <div className="flex flex-col gap-1.5 px-3 pb-3">
      {rows.map((row) => {
        if (row.id !== routed) return <ThreadRow key={row.id} row={row} guide={guide} />;
        const thread = full(row.id);
        return thread ? <ThreadCard key={row.id} thread={thread} showLocation /> : <Loading key={row.id} label="Loading thread" rows={2} />;
      })}
    </div>
  );
}

/** A collapsible titled section of rows; its header is the toggle. */
export function Section({ label, count, children }: { label: string; count: number; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <section aria-label={label}>
      <button type="button" aria-expanded={open} className="flex w-full items-center gap-1 px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase hover:text-foreground" onClick={() => setOpen(!open)}>
        {open ? <ChevronDownIcon className="size-3.5" aria-hidden /> : <ChevronRightIcon className="size-3.5" aria-hidden />}
        {label} <span className="font-normal">{count}</span>
      </button>
      {open && children}
    </section>
  );
}

const GROUPS: StateGroup[] = ['needs-you', 'unsent', 'waiting'];

/** Open threads under collapsible state sections (needs you, will be sent, waiting on the agent), empty ones left out. */
export function StateSections({ rows, full }: { rows: ThreadRowModel[]; full: (id: string) => Thread | undefined }) {
  return (
    <>
      {GROUPS.map((g) => {
        const inGroup = rows.filter((r) => stateGroup(r.state) === g);
        return inGroup.length ? <Section key={g} label={GROUP_LABEL[g]} count={inGroup.length}><ThreadList rows={inGroup} full={full} /></Section> : null;
      })}
    </>
  );
}
