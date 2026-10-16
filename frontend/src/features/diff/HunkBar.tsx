import { MessageSquarePlusIcon } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { Hunk, Verdict } from '@/lib/types';
import { useReviewCtx } from '@/state/reviewContext';
import { useReviewActions } from '@/state/threads';
import { Composer } from '@/features/threads/Composer';

const VERDICTS: { value: Verdict; label: string }[] = [{ value: 'accepted', label: 'Accept' }, { value: 'rejected', label: 'Reject' }, { value: 'pending', label: 'Pending' }];

/** Per-hunk verdict toggle and "comment on hunk". No bar at all in the commit-filter view. */
export function HunkBar({ hunk, commentable }: { hunk: Hunk; commentable: boolean }) {
  const { review, readOnly, commit } = useReviewCtx();
  const actions = useReviewActions();
  const [composing, setComposing] = useState(false);
  if (commit) return null;
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
              variant={(hunk.verdict ?? 'pending') === v.value ? 'secondary' : 'ghost'}
              aria-pressed={(hunk.verdict ?? 'pending') === v.value}
              disabled={closed}
              className="rounded-none first:rounded-l-md last:rounded-r-md"
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
