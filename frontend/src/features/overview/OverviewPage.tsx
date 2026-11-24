import { ArrowLeftIcon } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { navigate } from '@/lib/route';
import { firstUndecided, reviewProgress } from '@/lib/progress';
import { ago } from '@/lib/relativeTime';
import { useReviewCtx } from '@/state/reviewContext';
import { ActivityCard } from './ActivityCard';
import { HunksCard } from './HunksCard';
import { NeedsYouCard } from './NeedsYouCard';
import { onSectionRequest, takeSection } from './section';
import { YourThreadsCard } from './YourThreadsCard';

/** The review at a glance, shown where no file is open: what to do next, what needs the human, what the agent did. */
export function OverviewPage({ onBack }: { onBack?: () => void }) {
  const { review, files } = useReviewCtx();
  const hunksHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const land = () => {
      if (takeSection() !== 'hunks') return;
      hunksHeading.current?.scrollIntoView?.({ block: 'start' });
      hunksHeading.current?.focus();
    };
    land();
    return onSectionRequest(land);
  }, []);
  const progress = reviewProgress(review);
  const next = progress && progress.undecided > 0 ? firstUndecided(files) : undefined;
  const additions = files.reduce((n, f) => n + f.additions, 0);
  const deletions = files.reduce((n, f) => n + f.deletions, 0);
  return (
    <div className="mx-auto flex w-full min-w-0 max-w-5xl flex-col gap-3 p-3 sm:p-4">
      {onBack && <Button variant="ghost" size="sm" className="w-fit" onClick={onBack}><ArrowLeftIcon />Back to files</Button>}
      <header className="flex flex-col gap-1">
        <p className="text-xs text-muted-foreground">
          Round {review.round} · {review.label} · {files.length} {files.length === 1 ? 'file' : 'files'} +{additions} −{deletions} · opened {ago(review.createdAt)}
        </p>
        <h2 className="text-lg font-semibold">{review.title || review.label}</h2>
        <div className="flex flex-wrap items-center gap-2">
          {next && (
            <Button
              className="h-auto min-w-0 max-w-full flex-col items-start gap-0.5 py-2 text-left whitespace-normal"
              title={next.path}
              onClick={() => navigate({ file: next.path, side: undefined, lines: undefined, thread: undefined })}
            >
              Review next undecided hunk
              <span className="max-w-full break-all font-mono text-xs font-normal opacity-80">{next.path} · {next.verdicts!.pending} undecided</span>
            </Button>
          )}
          {progress && !next && <p className="text-sm text-muted-foreground">All hunks decided</p>}
        </div>
      </header>
      <NeedsYouCard />
      <div className="grid gap-3 lg:grid-cols-2">
        <HunksCard headingRef={hunksHeading} />
        <YourThreadsCard />
      </div>
      <ActivityCard />
    </div>
  );
}
