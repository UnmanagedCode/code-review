import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useCloseReview, useInbox } from '@/state/inbox';
import { Empty, ErrorState, Loading } from '@/features/common/States';
import { Badge } from '@/components/ui/badge';
import { BUCKET_LABEL, groupInbox } from '@/lib/inbox';
import type { InboxBucket, InboxItem } from '@/lib/types';
import { InboxRow } from './InboxRow';

const HEADING = 'flex items-center gap-2 border-b bg-muted/40 px-3 py-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase';

/** One inbox section; Stale starts collapsed behind a disclosure button, its rows not rendered until opened. */
function Section({ bucket, items, onClose }: { bucket: InboxBucket; items: InboxItem[]; onClose: (id: string) => void }) {
  const [open, setOpen] = useState(bucket !== 'stale');
  const count = <Badge variant="secondary" aria-label={`${items.length} reviews`}>{items.length}</Badge>;
  const listId = `inbox-${bucket}-list`;
  return (
    <section aria-labelledby={`inbox-${bucket}`}>
      <h2 id={`inbox-${bucket}`} className={bucket === 'stale' ? 'border-b bg-muted/40 text-xs font-semibold tracking-wide text-muted-foreground uppercase' : HEADING}>
        {bucket === 'stale' ? (
          <button type="button" aria-expanded={open} aria-controls={listId} onClick={() => setOpen(!open)} className={`${HEADING} w-full cursor-pointer border-b-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring`}>
            {open ? <ChevronDown className="size-3.5" aria-hidden /> : <ChevronRight className="size-3.5" aria-hidden />}
            {BUCKET_LABEL[bucket]}
            {count}
          </button>
        ) : (<>{BUCKET_LABEL[bucket]}{count}</>)}
      </h2>
      {open && <ul id={listId}>{items.map((r) => <InboxRow key={r.id} item={r} accent={bucket === 'needs-you'} onClose={onClose} />)}</ul>}
    </section>
  );
}

/** Every open review of every project and checkout in the server's triage sections: what needs you, what waits on an agent, the rest, and the stale. */
export function Inbox() {
  const inbox = useInbox();
  const close = useCloseReview(inbox.reload);
  return (
    <section aria-label="Inbox" className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {inbox.loading && !inbox.data ? <Loading label="Loading inbox" />
          : inbox.error && !inbox.data ? <ErrorState error={inbox.error} onRetry={inbox.reload} />
            : inbox.data && inbox.data.reviews.length === 0 ? <Empty title="No open reviews" />
              : inbox.data?.reviews.length ? groupInbox(inbox.data.reviews).map(({ bucket, items }) => (
                <Section key={bucket} bucket={bucket} items={items} onClose={close} />
              )) : null}
      </div>
    </section>
  );
}
