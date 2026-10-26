import type { RangeMark } from '@/lib/ranges';
import type { MarkedSeg } from '@/lib/segments';
import { contains, type Selection } from '@/lib/selection';
import type { DiffLine, Side } from '@/lib/types';
import { cn } from '@/lib/utils';
import { CodeLine, EMPHASIS } from './CodeLine';
import { Gutter } from './Gutter';
import type { LineSelection } from './useLineSelection';

/** One unified-diff line: old and new gutters, the ± marker and the text (scrolls sideways in its block), highlighted once `segs` are known. */
export function InlineRow({ line, sel, enabled, target, marks, segs }: { line: DiffLine; sel: LineSelection; enabled: boolean; target: Selection | null; marks: (side: Side, n: number) => RangeMark[]; segs?: MarkedSeg[] }) {
  const inTarget = !!target && contains(target, target.side, line[target.side]);
  const selected = contains(sel.selection, 'new', line.new) || contains(sel.selection, 'old', line.old);
  return (
    <div
      role="row"
      aria-selected={selected}
      data-line-target={target && inTarget && line[target.side] === target.start ? '' : undefined}
      className={cn('flex w-max min-w-full', line.t === 'add' && 'bg-success/10', line.t === 'del' && 'bg-destructive/10', inTarget && 'bg-warning/20', selected && 'bg-info/20')}
    >
      <Gutter side="old" n={line.old} sel={sel} enabled={enabled} marks={line.old == null ? [] : marks('old', line.old)} />
      <Gutter side="new" n={line.new} sel={sel} enabled={enabled} marks={line.new == null ? [] : marks('new', line.new)} />
      <div role="gridcell" aria-hidden className="w-4 shrink-0 text-center text-muted-foreground select-none">{marker(line)}</div>
      <div role="gridcell" className="pr-3 whitespace-pre">{segs ? <CodeLine segs={segs} emphasisClass={EMPHASIS[line.t]} /> : line.text}</div>
    </div>
  );
}

export const marker = (line: DiffLine | null) => (!line ? '' : line.t === 'add' ? '+' : line.t === 'del' ? '−' : ' ');
