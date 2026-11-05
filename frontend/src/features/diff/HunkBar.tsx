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

/** The segmented Accept / Reject / Pending control; `labels` name the three segments in that order. */
/** `repeatable`: choosing the pressed segment again still fires `onChange` (a group verdict re-runs its hunk writes). */
export function VerdictToggle({ label, value, labels, disabled, repeatable, onChange }: {
  label: string; value: Verdict; labels: [string, string, string]; disabled?: boolean; repeatable?: boolean; onChange: (v: Verdict) => void;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-md border">
      {VERDICTS.map((v, i) => (
        <Button
          key={v.value}
          size="sm"
          variant="ghost"
          aria-pressed={value === v.value}
          disabled={disabled}
          className={cn(SEGMENT_SHAPE, v.tint)}
          onClick={() => (repeatable || value !== v.value) && onChange(v.value)}
        >
          {labels[i]}
        </Button>
      ))}
    </div>
  );
}

/** Per-hunk verdict toggle and "comment on hunk". No bar at all in the commit-filter, past-round and comparison views. `path`: the hunk's file, whose cached diff the verdict patches. */
export function HunkBar({ hunk, path, commentable }: { hunk: Hunk; path: string; commentable: boolean }) {
  const { review, readOnly, commit, pastView } = useReviewCtx();
  const actions = useReviewActions();
  const [composing, setComposing] = useState(false);
  if (commit || pastView) return null;
  const hasVerdicts = review.kind !== 'uncommitted';
  const closed = review.status === 'closed';
  return (
    <div className="flex flex-wrap items-center gap-2 py-1">
      {hasVerdicts && (
        <VerdictToggle
          label="Hunk verdict" value={hunk.verdict ?? 'pending'} labels={['Accept', 'Reject', 'Pending']} disabled={closed}
          onChange={(v) => actions.setVerdict(path, hunk.id, v, hunk.verdict)}
        />
      )}
      {commentable && !readOnly && (
        <Button size="sm" variant="ghost" onClick={() => setComposing(true)}><MessageSquarePlusIcon />Comment on hunk</Button>
      )}
      {composing && (
        <div className="basis-full"><Composer anchor={{ kind: 'hunk', hunkId: hunk.id }} label="This hunk" onClose={() => setComposing(false)} /></div>
      )}
    </div>
  );
}
