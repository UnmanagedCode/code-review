import { cn } from '@/lib/utils';
import type { FileState } from '@/lib/types';

/** Most hunks drawn one square each; a file with more shows a three-segment bar. */
const MAX_PIPS = 8;
const TONES = { accepted: 'bg-success', rejected: 'bg-destructive', undecided: 'border border-muted-foreground/60' } as const;

/**
 * A file's verdicts at a glance: one square per hunk (accepted, rejected, undecided), or a proportional bar past `MAX_PIPS`.
 * A file with no verdicts (uncommitted, or a past view) says its hunk count instead.
 */
export function HunkPips({ file }: { file: FileState }) {
  const v = file.verdicts;
  if (!v) return <span className="text-xs text-muted-foreground">{file.hunks} {file.hunks === 1 ? 'hunk' : 'hunks'}</span>;
  const label = `${v.accepted} accepted, ${v.rejected} rejected, ${v.pending} undecided`;
  const parts = [['accepted', v.accepted], ['rejected', v.rejected], ['undecided', v.pending]] as const;
  if (file.hunks > MAX_PIPS) {
    return (
      <span role="img" aria-label={label} className="flex h-2 w-12 shrink-0 overflow-hidden rounded-sm border border-muted-foreground/40">
        {parts.map(([tone, n]) => n > 0 && <span key={tone} className={cn('h-full', tone !== 'undecided' && TONES[tone])} style={{ width: `${(n / file.hunks) * 100}%` }} />)}
      </span>
    );
  }
  return (
    <span role="img" aria-label={label} className="flex shrink-0 items-center gap-0.5">
      {parts.flatMap(([tone, n]) => Array.from({ length: n }, (_, i) => <span key={`${tone}${i}`} className={cn('size-2 rounded-[2px]', TONES[tone])} />))}
    </span>
  );
}
