import { MessageSquarePlusIcon } from 'lucide-react';
import { useState, type Ref } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Hunk, Verdict } from '@/lib/types';
import { useReviewCtx } from '@/state/reviewContext';
import { useReviewActions } from '@/state/threads';
import { SEGMENT_SHAPE } from '@/features/common/segment';
import { Composer } from '@/features/threads/Composer';

const ACTIONS = ['accepted', 'rejected'] as const;

// The link variant's primary colour misses AA on the page background, so these actions use the foreground colour.
const LINK_ACTION = 'h-auto px-0 text-foreground underline';

const CHIP: Record<'accepted' | 'rejected', { text: string; tint: string }> = {
  accepted: { text: '✓ Accepted', tint: 'bg-success/25' },
  rejected: { text: '✗ Rejected', tint: 'bg-destructive/25' },
};

/**
 * An Accept | Reject verdict: an undecided subject offers the two with neither drawn as chosen; a decided one shows its verdict
 * as a chip with a Clear link (and `again`, when a decided verdict can still be re-applied). Every change goes through
 * `onChange`, so keys, buttons and the server write stay one path. `labels` name Accept and Reject; `ref` reaches the group
 * element, which takes focus without being a tab stop.
 */
export function VerdictChoice({ label, labels, value, disabled, onChange, again, ref }: {
  label: string; labels: [string, string]; value: Verdict; disabled?: boolean; onChange: (v: Verdict) => void;
  again?: { label: string; onClick: () => void }; ref?: Ref<HTMLDivElement>;
}) {
  if (value === 'pending') {
    return (
      <div ref={ref} tabIndex={-1} role="group" aria-label={label} className="inline-flex items-center gap-2 outline-none">
        <span className="text-xs text-muted-foreground">undecided</span>
        <span className="inline-flex rounded-md border">
          {ACTIONS.map((a, i) => (
            <Button key={a} size="sm" variant="ghost" aria-pressed={false} disabled={disabled} className={SEGMENT_SHAPE} onClick={() => onChange(a)}>{labels[i]}</Button>
          ))}
        </span>
      </div>
    );
  }
  const chip = CHIP[value];
  return (
    <div ref={ref} tabIndex={-1} role="group" aria-label={label} className="inline-flex flex-wrap items-center gap-2 outline-none">
      <span className={cn('rounded-md px-2 py-1 text-xs font-medium text-foreground', chip.tint)}>{chip.text}</span>
      {again && <Button size="sm" variant="link" disabled={disabled} className={LINK_ACTION} onClick={again.onClick}>{again.label}</Button>}
      <Button size="sm" variant="link" disabled={disabled} className={LINK_ACTION} onClick={() => onChange('pending')}>Clear</Button>
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
        <VerdictChoice label="Hunk verdict" labels={['Accept', 'Reject']} value={hunk.verdict ?? 'pending'} disabled={closed} onChange={(v) => actions.setVerdict(path, hunk.id, v, hunk.verdict)} />
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
