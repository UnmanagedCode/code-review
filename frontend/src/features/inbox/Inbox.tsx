import { useCloseReview, useInbox } from '@/state/inbox';
import { Empty, ErrorState, Loading } from '@/features/common/States';
import { Badge } from '@/components/ui/badge';
import { BUCKET_LABEL, groupInbox } from '@/lib/inbox';
import { InboxRow } from './InboxRow';

/** Every open review of every project and checkout in triage sections: what needs you, what waits on an agent, the rest. */
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
                <section key={bucket} aria-labelledby={`inbox-${bucket}`}>
                  <h2 id={`inbox-${bucket}`} className="flex items-center gap-2 border-b bg-muted/40 px-3 py-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    {BUCKET_LABEL[bucket]}
                    <Badge variant="secondary" aria-label={`${items.length} reviews`}>{items.length}</Badge>
                  </h2>
                  <ul>{items.map((r) => <InboxRow key={r.id} item={r} accent={bucket === 'needs-you'} onClose={close} />)}</ul>
                </section>
              )) : null}
      </div>
    </section>
  );
}
