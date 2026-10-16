import type { Side } from '@/lib/types';
import { cn } from '@/lib/utils';
import type { useLineSelection } from './useLineSelection';

type Sel = ReturnType<typeof useLineSelection>;

/** One line-number cell. Selectable when it carries a number and selection is on. */
export function Gutter({ side, n, sel, enabled }: { side: Side; n: number | null; sel: Sel; enabled: boolean }) {
  if (n == null) return <div role="gridcell" aria-hidden className="w-12 shrink-0" />;
  if (!enabled) return <div role="gridcell" className="w-12 shrink-0 px-1 text-right text-muted-foreground select-none">{n}</div>;
  return (
    <div
      role="gridcell"
      data-cell={`${side}:${n}`}
      tabIndex={sel.tabStop(side, n) ? 0 : -1}
      aria-label={`${side} line ${n}`}
      onPointerDown={sel.onPointerDown(side, n)}
      onPointerEnter={sel.onPointerEnter(side, n)}
      onKeyDown={sel.onKeyDown(side, n)}
      className={cn('w-12 shrink-0 cursor-pointer px-1 text-right text-muted-foreground select-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none pointer-coarse:py-1.5')}
    >
      {n}
    </div>
  );
}
