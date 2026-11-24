import { CheckIcon } from 'lucide-react';
import type { Ref } from 'react';
import { RouteLink } from '@/components/RouteLink';
import { treeOrder } from '@/lib/fileTree';
import { fileProgress, reviewProgress } from '@/lib/progress';
import { useReviewCtx } from '@/state/reviewContext';
import { Card } from './Card';

/** Hunks decided per file, in tree order. Only reviews with verdicts have it. */
export function HunksCard({ headingRef }: { headingRef: Ref<HTMLHeadingElement> }) {
  const { review, files } = useReviewCtx();
  const progress = reviewProgress(review);
  if (!progress) return null;
  return (
    <Card title="Hunks" headingRef={headingRef}>
      <p className="text-sm">{progress.decided} of {progress.total} decided</p>
      <div role="progressbar" aria-label="Hunks decided" aria-valuemin={0} aria-valuenow={progress.decided} aria-valuemax={progress.total} className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-primary" style={{ width: `${progress.total ? (100 * progress.decided) / progress.total : 0}%` }} />
      </div>
      <ul className="flex flex-col">
        {treeOrder(files).map((f) => {
          const p = fileProgress(f)!;
          const done = p.decided === p.total;
          return (
            <li key={f.path}>
              <RouteLink to={{ file: f.path, side: undefined, lines: undefined, thread: undefined }} className="flex items-center gap-2 rounded-md p-1.5 text-sm hover:bg-accent">
                <span className="min-w-0 flex-1 break-all font-mono text-xs">{f.path}</span>
                <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                  {done && p.total > 0 && <CheckIcon className="size-3.5 text-success" aria-label="all decided" />}
                  {p.decided}/{p.total}
                </span>
              </RouteLink>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
