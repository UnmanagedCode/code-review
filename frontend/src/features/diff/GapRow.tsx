import { ChevronsDownUpIcon, ChevronsUpDownIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Row } from '@/lib/diffRows';
import { EXPAND_STEP } from '@/state/fileDiff';

/** Collapsed unchanged lines. `first`/`last` hide the direction that has no hunk to grow from. */
export function GapRow({ row, first, last, readOnly, onExpand }: {
  row: Extract<Row, { kind: 'gap' }>; first: boolean; last: boolean; readOnly: boolean; onExpand: (how: 'top' | 'bottom' | 'all') => void;
}) {
  return (
    <div role="row" className="sticky left-0 flex w-full flex-wrap items-center gap-x-2 bg-muted px-3 py-0.5 font-sans text-xs text-muted-foreground">
      <span>{row.remaining} unchanged {row.remaining === 1 ? 'line' : 'lines'}</span>
      {!readOnly && (
        <span className="flex gap-1">
          {row.remaining > EXPAND_STEP && !first && <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => onExpand('top')}><ChevronsDownUpIcon />Show {Math.min(EXPAND_STEP, row.remaining)} below</Button>}
          {row.remaining > EXPAND_STEP && !last && <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => onExpand('bottom')}><ChevronsUpDownIcon />Show {Math.min(EXPAND_STEP, row.remaining)} above</Button>}
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => onExpand('all')}>Show all</Button>
        </span>
      )}
    </div>
  );
}
