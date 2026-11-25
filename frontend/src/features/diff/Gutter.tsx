import { PlusIcon } from 'lucide-react';
import type { CSSProperties } from 'react';
import { markNote, type RangeMark } from '@/lib/ranges';
import type { Side } from '@/lib/types';
import { cn } from '@/lib/utils';
import type { LineSelection } from './useLineSelection';

/**
 * Thread range rails: one bar per range the line sits in, in its lane, capped on the range's first and last line.
 * Never a background on the cell or row: it must combine with the add/del, target and selection tints. Light `primary`
 * misses 3:1 against those tints, so the active rail takes the darker same-hue `accent-foreground` there. A bar is a
 * background on an empty span, which forced colours would paint as Canvas, so it opts out and takes system colours,
 * `!important` so the `dark:` rule (higher specificity) can't win; the focused bar is also wider there.
 */
function Rails({ marks }: { marks: RangeMark[] }) {
  if (!marks.length) return null;
  return (
    <span aria-hidden data-rails="" data-active={marks.some((m) => m.active) ? '' : undefined} className="pointer-events-none absolute inset-y-0 left-0.5 forced-colors:left-0">
      {marks.map((m) => (
        <span
          key={m.threadId}
          style={{ '--lane': m.lane } as CSSProperties}
          className={cn('absolute inset-y-0 left-[calc(var(--lane)*4px)] forced-color-adjust-none forced-colors:left-[calc(var(--lane)*5px)]', m.active ? 'w-[3px] bg-accent-foreground dark:bg-primary forced-colors:w-1 forced-colors:bg-[Highlight]!' : 'w-0.5 bg-muted-foreground forced-colors:bg-[CanvasText]!', m.first && 'top-0.5 rounded-t-full', m.last && 'bottom-0.5 rounded-b-full')}
        />
      ))}
    </span>
  );
}

/**
 * The hover/focus cue that a line number can be clicked or dragged. `pointer-events-none`: the press, the drag
 * (`pointerenter` on the cells) and the release must land on the cell. Hidden until `hover:` (wrapped in
 * `(hover: hover)`, so never on touch) or focus-visible. The fill is the active rail pair (≥ 3:1 on every row tint),
 * and opts out of forced colours like the rails do, else its background would paint as Canvas.
 */
function CommentPlus({ compact }: { compact: boolean }) {
  return (
    <span
      aria-hidden data-comment-plus=""
      className={cn('pointer-events-none absolute top-1/2 z-10 hidden -translate-y-1/2 items-center justify-center rounded bg-accent-foreground text-background group-hover/gutter:flex group-focus-visible/gutter:flex dark:bg-primary forced-color-adjust-none forced-colors:bg-[CanvasText]! forced-colors:text-[Canvas]!', compact ? 'left-0 size-2.5' : 'left-0.5 size-4')}
    >
      <PlusIcon className={compact ? 'size-2' : 'size-3'} />
    </span>
  );
}

/** One line-number cell. Width: the stock gutter, or the file's `--gutter-w` (`lib/gutter.ts`); `compact` is the wrapped, narrow layout's. Selectable when it carries a number and selection is on. */
export function Gutter({ side, n, sel, enabled, marks, className, compact = false }: { side: Side; n: number | null; sel: LineSelection; enabled: boolean; marks: RangeMark[]; className?: string; compact?: boolean }) {
  const width = compact ? 'w-[var(--gutter-w,2.25rem)]' : 'w-[var(--gutter-w,3rem)]';
  if (n == null) return <div role="gridcell" aria-hidden className={cn(width, 'shrink-0', className)} />;
  const active = marks.some((m) => m.active) && 'text-foreground';
  if (!enabled) {
    return (
      <div role="gridcell" className={cn(width, 'relative shrink-0 px-1 text-right text-muted-foreground select-none', active, className)}>
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
      className={cn(width, 'group/gutter relative shrink-0 cursor-pointer px-1 text-right text-muted-foreground select-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none pointer-coarse:py-1.5', active, className)}
    >
      <Rails marks={marks} />
      <CommentPlus compact={compact} />
      {n}
    </div>
  );
}
