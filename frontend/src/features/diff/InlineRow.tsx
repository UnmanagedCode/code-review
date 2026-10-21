import { contains, type Selection } from '@/lib/selection';
import type { DiffLine } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Gutter } from './Gutter';
import type { LineSelection } from './useLineSelection';

/** One unified-diff line: old and new gutters, the ± marker and the text (scrolls sideways in its block). */
export function InlineRow({ line, sel, enabled, target }: { line: DiffLine; sel: LineSelection; enabled: boolean; target: Selection | null }) {
  const inTarget = !!target && contains(target, target.side, line[target.side]);
  const selected = contains(sel.selection, 'new', line.new) || contains(sel.selection, 'old', line.old);
  return (
    <div
      role="row"
      aria-selected={selected}
      data-line-target={target && inTarget && line[target.side] === target.start ? '' : undefined}
      className={cn('flex w-max min-w-full', line.t === 'add' && 'bg-success/10', line.t === 'del' && 'bg-destructive/10', inTarget && 'bg-warning/20', selected && 'bg-info/20')}
    >
      <Gutter side="old" n={line.old} sel={sel} enabled={enabled} />
      <Gutter side="new" n={line.new} sel={sel} enabled={enabled} />
      <div role="gridcell" aria-hidden className="w-4 shrink-0 text-center text-muted-foreground select-none">{marker(line)}</div>
      <div role="gridcell" className="pr-3 whitespace-pre">{line.text}</div>
    </div>
  );
}

export const marker = (line: DiffLine | null) => (!line ? '' : line.t === 'add' ? '+' : line.t === 'del' ? '−' : ' ');
