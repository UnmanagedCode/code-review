import { MessageSquarePlusIcon } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Hunk, Verdict } from '@/lib/types';
import { useReviewCtx } from '@/state/reviewContext';
import { useReviewActions } from '@/state/threads';
import { SEGMENT_SHAPE } from '@/features/common/segment';
import { Composer } from '@/features/threads/Composer';

// The active segment carries its verdict's hue in the background, with neutral text for contrast; unpressed segments stay neutral. Classes are written out so Tailwind's scanner sees them.
const VERDICTS: { value: Verdict; label: string; tint: string }[] = [
  { value: 'accepted', label: 'Accept', tint: 'aria-pressed:bg-success/25 aria-pressed:text-foreground aria-pressed:hover:bg-success/30 dark:aria-pressed:hover:bg-success/30' },
  { value: 'rejected', label: 'Reject', tint: 'aria-pressed:bg-destructive/25 aria-pressed:text-foreground aria-pressed:hover:bg-destructive/30 dark:aria-pressed:hover:bg-destructive/30' },
  { value: 'pending', label: 'Pending', tint: 'aria-pressed:bg-info/25 aria-pressed:text-foreground aria-pressed:hover:bg-info/30 dark:aria-pressed:hover:bg-info/30' },
];

/** Per-hunk verdict toggle and "comment on hunk". No bar at all in the commit-filter, past-round and comparison views. */
export function HunkBar({ hunk, commentable }: { hunk: Hunk; commentable: boolean }) {
  const { review, readOnly, commit, pastView } = useReviewCtx();
  const actions = useReviewActions();
  const [composing, setComposing] = useState(false);
  if (commit || pastView) return null;
  const hasVerdicts = review.kind !== 'uncommitted';
  const closed = review.status === 'closed';
  return (
    <div className="flex flex-wrap items-center gap-2 py-1">
      {hasVerdicts && (
        <div role="group" aria-label="Hunk verdict" className="inline-flex rounded-md border">
          {VERDICTS.map((v) => (
            <Button
              key={v.value}
              size="sm"
              variant="ghost"
              aria-pressed={(hunk.verdict ?? 'pending') === v.value}
              disabled={closed}
              className={cn(SEGMENT_SHAPE, v.tint)}
              onClick={() => (hunk.verdict ?? 'pending') !== v.value && actions.setVerdict(hunk.id, v.value, hunk.verdict)}
            >
              {v.label}
            </Button>
          ))}
        </div>
      )}
      {commentable && !readOnly && (
        <Button size="sm" variant="ghost" onClick={() => setComposing(true)}><MessageSquarePlusIcon />Comment on hunk</Button>
      )}
      {composing && (
        <div className="basis-full"><Composer anchor={{ hunkId: hunk.id }} label="This hunk" onClose={() => setComposing(false)} /></div>
      )}
    </div>
  );
}
