import type { MarkedSeg } from '@/lib/segments';
import type { DiffLine } from '@/lib/types';
import { cn } from '@/lib/utils';

/** Word emphasis per line type: an inner background, so it stacks on the row's add/del, target or selection tint. */
export const EMPHASIS: Partial<Record<DiffLine['t'], string>> = { add: 'bg-success/35', del: 'bg-destructive/35' };

/** A line's segments as spans; the text is only ever React text. */
export function CodeLine({ segs, emphasisClass }: { segs: MarkedSeg[]; emphasisClass?: string }) {
  return (
    <>
      {segs.map((s, i) => (
        <span key={i} className={cn(s.cls, s.em && emphasisClass)} data-token={s.cls ? '' : undefined} data-emphasis={s.em ? '' : undefined}>
          {s.text}
        </span>
      ))}
    </>
  );
}
