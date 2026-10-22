import { markNote, type RangeMark } from '@/lib/ranges';
import type { Side } from '@/lib/types';
import { cn } from '@/lib/utils';
import type { LineSelection } from './useLineSelection';

/**
 * Thread range rails: one bar per range the line sits in, in its lane, capped on the range's first and last line.
 * Never a background on the cell or row: it must combine with the add/del, target and selection tints. Light `primary`
 * misses 3:1 against those tints, so the active rail takes the darker same-hue `accent-foreground` there. A bar is a
 * background on an empty span, which forced colours would paint as Canvas, so it opts out and takes system colours.
 */
function Rails({ marks }: { marks: RangeMark[] }) {
  if (!marks.length) return null;
  return (
    <span aria-hidden data-rails="" data-active={marks.some((m) => m.active) ? '' : undefined} className="pointer-events-none absolute inset-y-0 left-0.5">
      {marks.map((m) => (
        <span
          key={m.threadId}
          style={{ left: m.lane * 4 }}
          className={cn('absolute inset-y-0 forced-color-adjust-none', m.active ? 'w-[3px] bg-accent-foreground dark:bg-primary forced-colors:bg-[Highlight]' : 'w-0.5 bg-muted-foreground forced-colors:bg-[CanvasText]', m.first && 'top-0.5 rounded-t-full', m.last && 'bottom-0.5 rounded-b-full')}
        />
      ))}
    </span>
  );
}

/** One line-number cell. Selectable when it carries a number and selection is on. */
export function Gutter({ side, n, sel, enabled, marks, className }: { side: Side; n: number | null; sel: LineSelection; enabled: boolean; marks: RangeMark[]; className?: string }) {
  if (n == null) return <div role="gridcell" aria-hidden className={cn('w-12 shrink-0', className)} />;
  const active = marks.some((m) => m.active) && 'text-foreground';
  if (!enabled) {
    return (
      <div role="gridcell" className={cn('relative w-12 shrink-0 px-1 text-right text-muted-foreground select-none', active, className)}>
        <Rails marks={marks} />
        {n}
        {marks.length > 0 && <span className="sr-only">{markNote(marks)}</span>}
      </div>
    );
  }
  return (
    <div
      role="gridcell"
      data-cell={`${side}:${n}`}
      tabIndex={sel.tabStop(side, n) ? 0 : -1}
      aria-label={`${side} line ${n}${markNote(marks)}`}
      onPointerDown={sel.onPointerDown(side, n)}
      onPointerEnter={sel.onPointerEnter(side, n)}
      onKeyDown={sel.onKeyDown(side, n)}
      className={cn('relative w-12 shrink-0 cursor-pointer px-1 text-right text-muted-foreground select-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none pointer-coarse:py-1.5', active, className)}
    >
      <Rails marks={marks} />
      {n}
    </div>
  );
}
