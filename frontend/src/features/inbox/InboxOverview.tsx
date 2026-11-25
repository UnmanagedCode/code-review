import { RouteLink } from '@/components/RouteLink';
import { Button } from '@/components/ui/button';
import { Empty } from '@/features/common/States';
import { needsYouOf } from '@/lib/inbox';
import { REVIEW_SCOPED } from '@/lib/route';
import { useInbox } from '@/state/inbox';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The desktop centre while no review is open: what the inbox holds in a sentence, and a way in to the first review that needs you. */
export function InboxOverview() {
  const { data } = useInbox();
  if (!data) return <Empty title="Select a review" />;
  const needing = data.reviews.filter((r) => r.bucket === 'needs-you');
  const waiting = data.reviews.filter((r) => r.bucket === 'waiting').length;
  const first = needing[0]; // the server orders Needs you by urgency
  if (needing.length === 0) return <Empty title="Nothing needs you right now">{waiting > 0 ? `${plural(waiting, 'review')} waiting on an agent` : 'Select a review from the inbox.'}</Empty>;
  const threads = needing.reduce((n, r) => n + needsYouOf(r), 0);
  const withThreads = needing.filter((r) => needsYouOf(r) > 0).length;
  return (
    <Empty title={`${plural(needing.length, 'review')} ${needing.length === 1 ? 'needs' : 'need'} you`}>
      <p>
        {plural(threads, 'thread')} {threads === 1 ? 'waits' : 'wait'} on you across {plural(withThreads, 'review')} · {waiting} waiting on an agent
      </p>
      {first && (
        <Button asChild className="mt-3">
          <RouteLink to={{ project: first.project, worktree: first.worktree ?? undefined, review: first.id, ...REVIEW_SCOPED }}>
            Start with “{first.title || first.label}”
          </RouteLink>
        </Button>
      )}
    </Empty>
  );
}
