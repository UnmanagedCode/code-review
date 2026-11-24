import { RouteLink } from '@/components/RouteLink';
import { requestSection } from '@/features/overview/section';
import { reviewProgress } from '@/lib/progress';
import { LEAVE_FILE, type Route } from '@/lib/route';
import type { StateGroup } from '@/lib/threadState';
import { PRIMARY_TEXT } from '@/components/tone';
import { cn } from '@/lib/utils';
import { useReviewCtx } from '@/state/reviewContext';

// The commit filter has no overview, so the link leaves it too.
const TO_OVERVIEW = { ...LEAVE_FILE, commit: undefined, view: 'overview' } as const satisfies Route;
const PILL = 'rounded-full border px-2 py-0.5 text-xs';

/**
 * The review's progress at a glance: hunks decided, and the open threads by whose move they wait on. Each number links to the
 * list it counts. Absent in past-round views and comparisons.
 */
export function ProgressStrip() {
  const { review, pastView } = useReviewCtx();
  const progress = reviewProgress(review);
  const s = review.counts.threadStates;
  const pills: { group: StateGroup; n: number; text: string; name: string; primary?: boolean }[] = [
    { group: 'needs-you', n: s.awaitingHuman + s.verifyResolution, text: 'need you', name: 'need you', primary: true },
    { group: 'unsent', n: s.unsent, text: 'will be sent', name: 'will be sent' },
    { group: 'waiting', n: s.awaitingAgent, text: 'waiting on agent', name: 'waiting on agent' },
  ];
  const shown = pills.filter((p) => p.n > 0);
  if (pastView || (!progress && !shown.length)) return null;
  return (
    <section aria-label="Review progress" className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs">
        {progress && (
          <>
            <span><strong className="font-semibold">Hunks</strong> {progress.decided} of {progress.total} decided</span>
            {progress.undecided > 0 && (
              <RouteLink to={TO_OVERVIEW} onClick={() => requestSection('hunks')} className={cn(PRIMARY_TEXT, 'hover:underline')}>
                {progress.undecided} undecided →
              </RouteLink>
            )}
          </>
        )}
        <span className="flex-1" />
        <RouteLink to={TO_OVERVIEW} className="text-muted-foreground hover:text-foreground hover:underline">Overview</RouteLink>
      </div>
      {progress && (
        <div role="progressbar" aria-label="Hunks decided" aria-valuemin={0} aria-valuenow={progress.decided} aria-valuemax={progress.total} className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-primary" style={{ width: `${progress.total ? (100 * progress.decided) / progress.total : 0}%` }} />
        </div>
      )}
      {shown.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {shown.map((p) => {
            const tone = cn(PILL, p.primary && ['border-primary/40 bg-primary/10', PRIMARY_TEXT]);
            const body = <><strong className="font-semibold">{p.n}</strong> {p.text}</>;
            // The Threads tab lists file and line threads from the diff: with it unreadable the list would disagree with the count.
            return review.snapshotError
              ? <span key={p.group} className={tone}>{body}</span>
              : (
                <RouteLink key={p.group} to={{ view: 'threads', need: p.group }} aria-label={`${p.n} ${p.n === 1 ? 'thread' : 'threads'} ${p.name}`} className={cn(tone, 'hover:bg-accent')}>
                  {body}
                </RouteLink>
              );
          })}
        </div>
      )}
    </section>
  );
}
