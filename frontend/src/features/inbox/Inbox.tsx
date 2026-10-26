import { useCloseReview, useInbox } from '@/state/inbox';
import { Empty, ErrorState, Loading } from '@/features/common/States';
import { InboxRow } from './InboxRow';

/** Every open review of every project and checkout, latest activity first, each saying whose turn it is. */
export function Inbox() {
  const inbox = useInbox();
  const close = useCloseReview(inbox.reload);
  return (
    <section aria-label="Inbox" className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {inbox.loading && !inbox.data ? <Loading label="Loading inbox" />
          : inbox.error && !inbox.data ? <ErrorState error={inbox.error} onRetry={inbox.reload} />
            : inbox.data && inbox.data.reviews.length === 0 ? <Empty title="No open reviews" />
              : <ul>{inbox.data?.reviews.map((r) => <InboxRow key={r.id} item={r} onClose={close} />)}</ul>}
      </div>
    </section>
  );
}
