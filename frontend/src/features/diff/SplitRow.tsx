import type { RangeMark } from '@/lib/ranges';
import { contains, type Selection } from '@/lib/selection';
import { pairLine, type SplitRow as Pair } from '@/lib/splitRows';
import type { DiffLine, Side } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Gutter } from './Gutter';
import { marker } from './InlineRow';
import type { LineSelection } from './useLineSelection';

type PairRow = Extract<Pair, { kind: 'pair' }>;

/**
 * One side-by-side row: old gutter, marker, old text | new gutter, marker, new text, as six direct grid cells so both
 * halves share one height. Long lines wrap. Each half is tinted on its own: selection > target > add/del; an empty half is muted.
 */
export function SplitRow({ pair, sel, enabled, target, marks }: { pair: PairRow; sel: LineSelection; enabled: boolean; target: Selection | null; marks: (side: Side, n: number) => RangeMark[] }) {
  const half = (side: Side, line: DiffLine | null) => {
    const n = pairLine(pair, side);
    const selected = contains(sel.selection, side, n);
    const inTarget = !!target && contains(target, side, n);
    const tint = selected ? 'bg-info/20' : inTarget ? 'bg-warning/20' : !line ? 'bg-muted/50' : line.t === 'add' ? 'bg-success/10' : line.t === 'del' ? 'bg-destructive/10' : undefined;
    return { side, n, line, selected, tint };
  };
  const halves = [half('old', pair.left), half('new', pair.right)] as const;
  return (
    <div
      role="row"
      aria-selected={halves.some((h) => h.selected)}
      data-line-target={target && pairLine(pair, target.side) === target.start ? '' : undefined}
      className="grid grid-cols-[3rem_1rem_minmax(0,1fr)_3rem_1rem_minmax(0,1fr)]"
    >
      {halves.map((h, i) => [
        <Gutter key={`g${i}`} side={h.side} n={h.n} sel={sel} enabled={enabled} marks={h.n == null ? [] : marks(h.side, h.n)} className={h.tint} />,
        <div key={`m${i}`} role="gridcell" aria-hidden className={cn('text-center text-muted-foreground select-none', h.tint)}>{marker(h.line)}</div>,
        <div key={`t${i}`} role="gridcell" aria-hidden={h.line ? undefined : true} className={cn('min-w-0 pr-3 whitespace-pre-wrap wrap-anywhere', i === 0 && 'border-r', h.tint)}>{h.line?.text}</div>,
      ])}
    </div>
  );
}
